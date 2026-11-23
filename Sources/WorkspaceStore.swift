import Foundation
import Combine

struct WorkspaceCompany: Identifiable, Codable, Equatable {
    var id = UUID()
    var name = ""
    var registration = ""
    var city = ""
    var notes = ""
}

struct WorkspaceTask: Identifiable, Codable, Equatable {
    var id = UUID()
    var title = ""
    var due = Date()
    var companyID: UUID?
    var notes = ""
    var isDone = false
}

struct WorkspaceDocument: Identifiable, Codable, Equatable {
    var id: UUID
    var title: String
    var filename: String
    var added: Date
    var size: Int64
    var companyID: UUID? = nil
}

private struct WorkspaceSnapshot: Codable {
    var companies: [WorkspaceCompany] = []
    var tasks: [WorkspaceTask] = []
    var documents: [WorkspaceDocument] = []
    var retiredCompanyIDs: Set<UUID>?
}

private struct WorkspaceIssue: LocalizedError {
    let errorDescription: String?
    init(_ message: String) { errorDescription = message }
}

@MainActor
final class WorkspaceStore: ObservableObject {
    @Published private(set) var companies: [WorkspaceCompany] = []
    @Published private(set) var tasks: [WorkspaceTask] = []
    @Published private(set) var documents: [WorkspaceDocument] = []
    @Published private(set) var loadingError: String?
    var openTaskCount: Int { tasks.filter { !$0.isDone }.count }

    let session: CompanySession
    private let directory: URL
    private let fm = FileManager.default
    private var unlocked = true
    private var metadataURL: URL { directory.appendingPathComponent("workspace.json") }
    private var blobs: URL { directory.appendingPathComponent("files", isDirectory: true) }
    private var removed: URL { directory.appendingPathComponent("removed", isDirectory: true) }

    init(session: CompanySession, directory: URL? = nil) {
        self.session = session
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("AoosGPT/Workspace", isDirectory: true)
        do {
            try fm.createDirectory(at: blobs, withIntermediateDirectories: true)
            try fm.createDirectory(at: removed, withIntermediateDirectories: true)
            var snapshot = try readSnapshot()
            if !session.isOwner {
                guard snapshot.retiredCompanyIDs?.contains(session.id) != true else {
                    throw WorkspaceIssue("أغلق المالك مساحة هذه الشركة.")
                }
                if !snapshot.companies.contains(where: { $0.id == session.id }) {
                    snapshot.companies.append(WorkspaceCompany(id: session.id, name: session.displayName))
                    try persist(snapshot)
                }
            }
            try finishInterruptedDeletions(known: Set(snapshot.documents.map { $0.id.uuidString }))
            apply(snapshot)
        } catch {
            // A file provider error can contain an absolute path belonging to a different company.
            loadingError = (error as? WorkspaceIssue)?.errorDescription ?? "تعذّر فتح مساحة العمل. احتُفظ بالسجلات الحالية."
        }
    }

    func lock() {
        unlocked = false
        companies = []
        tasks = []
        documents = []
    }

    private func visible(toCompany companyID: UUID?) -> Bool {
        session.isOwner || companyID == session.id
    }

    private func apply(_ snapshot: WorkspaceSnapshot) {
        companies = snapshot.companies.filter { visible(toCompany: $0.id) }
        tasks = snapshot.tasks.filter { visible(toCompany: $0.companyID) }
        documents = snapshot.documents.filter { visible(toCompany: $0.companyID) }
    }

    private func ready() throws {
        guard unlocked else { throw WorkspaceIssue("انتهت الجلسة. سجّل الدخول مجددًا.") }
        if let loadingError { throw WorkspaceIssue(loadingError) }
    }

    private func readSnapshot() throws -> WorkspaceSnapshot {
        do {
            return try JSONDecoder().decode(WorkspaceSnapshot.self, from: Data(contentsOf: metadataURL))
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
            return WorkspaceSnapshot()
        }
    }

    private func currentSnapshot() throws -> WorkspaceSnapshot {
        try ready()
        let snapshot = try readSnapshot()
        guard session.isOwner || (snapshot.retiredCompanyIDs?.contains(session.id) != true &&
                snapshot.companies.contains(where: { $0.id == session.id })) else {
            lock()
            loadingError = "أغلق المالك مساحة هذه الشركة."
            throw WorkspaceIssue("أغلق المالك مساحة هذه الشركة.")
        }
        return snapshot
    }

    private func persist(_ snapshot: WorkspaceSnapshot) throws {
        try JSONEncoder().encode(snapshot).write(to: metadataURL, options: .atomic)
    }

    private func change(_ edit: (inout WorkspaceSnapshot) throws -> Void) throws {
        // All commits run synchronously on the main actor. Persist the complete current index;
        // the published arrays are a projection and cannot be used to reconstruct other companies.
        var snapshot = try currentSnapshot()
        try edit(&snapshot)
        try persist(snapshot)
        apply(snapshot)
    }

    func saveCompany(_ record: WorkspaceCompany) throws {
        var item = record
        item.name = item.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !item.name.isEmpty else { throw WorkspaceIssue("أدخل اسم المنشأة.") }
        try change { snapshot in
            guard visible(toCompany: item.id), snapshot.retiredCompanyIDs?.contains(item.id) != true else {
                throw WorkspaceIssue("تعذّر تعديل سجل المنشأة.")
            }
            if let index = snapshot.companies.firstIndex(where: { $0.id == item.id }) {
                snapshot.companies[index] = item
            } else {
                guard session.isOwner else { throw WorkspaceIssue("إضافة المنشآت متاحة للمالك.") }
                snapshot.companies.append(item)
            }
        }
    }

    func deleteCompany(_ id: UUID) throws {
        try change { snapshot in
            guard session.isOwner, let index = snapshot.companies.firstIndex(where: { $0.id == id }) else {
                throw WorkspaceIssue("تعذّر حذف سجل المنشأة.")
            }
            snapshot.companies.remove(at: index)
            var retired = snapshot.retiredCompanyIDs ?? []
            retired.insert(id)
            snapshot.retiredCompanyIDs = retired
            for index in snapshot.tasks.indices where snapshot.tasks[index].companyID == id {
                snapshot.tasks[index].companyID = nil
            }
            for index in snapshot.documents.indices where snapshot.documents[index].companyID == id {
                snapshot.documents[index].companyID = nil
            }
        }
    }

    func saveTask(_ record: WorkspaceTask) throws {
        var item = record
        item.title = item.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !item.title.isEmpty else { throw WorkspaceIssue("أدخل عنوان المهمة.") }
        try change { snapshot in
            if !session.isOwner {
                guard item.companyID == nil || item.companyID == session.id else {
                    throw WorkspaceIssue("اختر منشأة من مساحة عملك.")
                }
                item.companyID = session.id
            } else if !snapshot.companies.contains(where: { $0.id == item.companyID }) {
                item.companyID = nil
            }
            if let index = snapshot.tasks.firstIndex(where: { $0.id == item.id }) {
                guard visible(toCompany: snapshot.tasks[index].companyID) else {
                    throw WorkspaceIssue("لم يُعثر على المهمة في مساحة العمل.")
                }
                snapshot.tasks[index] = item
            } else {
                snapshot.tasks.append(item)
            }
        }
    }

    func deleteTask(_ id: UUID) throws {
        try change { snapshot in
            guard let index = snapshot.tasks.firstIndex(where: { $0.id == id && visible(toCompany: $0.companyID) }) else {
                throw WorkspaceIssue("لم يُعثر على المهمة في مساحة العمل.")
            }
            snapshot.tasks.remove(at: index)
        }
    }

    func importDocument(from source: URL) async throws {
        try ready()
        let id = UUID()
        // Copy outside the live archive. Another account can open the archive while a file
        // provider is downloading. The system replacement directory is on the same volume.
        let staging = try fm.url(for: .itemReplacementDirectory, in: .userDomainMask,
                                 appropriateFor: blobs, create: true)
        defer { try? fm.removeItem(at: staging) }
        let bundle = staging.appendingPathComponent(id.uuidString, isDirectory: true)
        let ownerID = session.isOwner ? nil : session.id
        let document = try await Task.detached(priority: .userInitiated) {
            let accessing = source.startAccessingSecurityScopedResource()
            defer { if accessing { source.stopAccessingSecurityScopedResource() } }
            let manager = FileManager.default
            let name = source.lastPathComponent
            let values = try source.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            guard values.isRegularFile == true, values.isSymbolicLink != true,
                  !name.isEmpty, name != ".", name != ".." else {
                throw WorkspaceIssue("اختر ملفًا يمكن قراءته.")
            }
            try manager.createDirectory(at: bundle, withIntermediateDirectories: false)
            let copy = bundle.appendingPathComponent(name)
            var coordinationError: NSError?
            var copyError: Error?
            NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: source, options: [], error: &coordinationError) { readable in
                do { try manager.copyItem(at: readable, to: copy) } catch { copyError = error }
            }
            if let coordinationError { throw coordinationError }
            if let copyError { throw copyError }
            let result = try copy.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
            guard result.isRegularFile == true, result.isSymbolicLink != true else {
                throw WorkspaceIssue("اختر ملفًا يمكن قراءته.")
            }
            return WorkspaceDocument(id: id, title: name, filename: name, added: Date(),
                                     size: Int64(result.fileSize ?? 0), companyID: ownerID)
        }.value
        try Task.checkCancellation()
        var snapshot = try currentSnapshot()
        let target = fileFolder(id)
        try fm.moveItem(at: bundle, to: target)
        snapshot.documents.append(document)
        do {
            try persist(snapshot)
            apply(snapshot)
        } catch {
            try? fm.removeItem(at: target)
            throw error
        }
    }

    private func fileFolder(_ id: UUID) -> URL { blobs.appendingPathComponent(id.uuidString, isDirectory: true) }

    private func documentIndex(_ id: UUID, in snapshot: WorkspaceSnapshot) throws -> Int {
        guard let index = snapshot.documents.firstIndex(where: { $0.id == id && visible(toCompany: $0.companyID) }) else {
            throw WorkspaceIssue("لم يُعثر على الملف في مساحة العمل.")
        }
        return index
    }

    func documentURL(_ document: WorkspaceDocument) throws -> URL {
        let snapshot = try currentSnapshot()
        let stored = snapshot.documents[try documentIndex(document.id, in: snapshot)]
        guard stored.filename == document.filename,
              stored.filename == (stored.filename as NSString).lastPathComponent,
              !["", ".", ".."].contains(stored.filename) else { throw WorkspaceIssue("اسم الملف غير صالح.") }
        let folder = fileFolder(stored.id)
        let url = folder.appendingPathComponent(stored.filename)
        let fields = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard fields.isRegularFile == true, fields.isSymbolicLink != true,
              try folder.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true,
              fm.isReadableFile(atPath: url.path) else {
            throw WorkspaceIssue("تعذّرت قراءة النسخة المحفوظة من هذا الملف.")
        }
        return url
    }

    func updateDocument(_ id: UUID, title: String, companyID: UUID?) throws {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw WorkspaceIssue("أدخل عنوانًا للملف.") }
        try change { snapshot in
            let index = try documentIndex(id, in: snapshot)
            if let companyID {
                guard visible(toCompany: companyID), snapshot.companies.contains(where: { $0.id == companyID }) else {
                    throw WorkspaceIssue("اختر منشأة من مساحة عملك.")
                }
            }
            snapshot.documents[index].title = name
            snapshot.documents[index].companyID = session.isOwner ? companyID : session.id
        }
    }

    func deleteDocument(_ id: UUID) throws {
        var snapshot = try currentSnapshot()
        let index = try documentIndex(id, in: snapshot)
        let original = fileFolder(id)
        let pending = removed.appendingPathComponent(id.uuidString, isDirectory: true)
        let exists = fm.fileExists(atPath: original.path)
        if exists { try fm.moveItem(at: original, to: pending) }
        snapshot.documents.remove(at: index)
        do {
            try persist(snapshot)
            apply(snapshot)
        } catch {
            if exists { try fm.moveItem(at: pending, to: original) }
            throw error
        }
        if exists { try? fm.removeItem(at: pending) }
    }

    private func finishInterruptedDeletions(known: Set<String>) throws {
        for item in try fm.contentsOfDirectory(at: removed, includingPropertiesForKeys: nil) {
            guard UUID(uuidString: item.lastPathComponent) != nil else { continue }
            if known.contains(item.lastPathComponent) {
                let destination = blobs.appendingPathComponent(item.lastPathComponent)
                if !fm.fileExists(atPath: destination.path) { try fm.moveItem(at: item, to: destination) }
            } else {
                try fm.removeItem(at: item)
            }
        }
        for item in try fm.contentsOfDirectory(at: blobs, includingPropertiesForKeys: nil)
        where UUID(uuidString: item.lastPathComponent) != nil && !known.contains(item.lastPathComponent) {
            try fm.removeItem(at: item)
        }
    }
}
