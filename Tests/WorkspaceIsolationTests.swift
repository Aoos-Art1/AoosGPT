import Foundation
@testable import AoosGPTTestSubject

private struct CheckFailed: Error, CustomStringConvertible {
    let description: String
}

@main
struct VerifyIsolation {
    @MainActor static func main() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let owner = CompanySession(id: UUID(), accountID: "owner", displayName: "Owner", isOwner: true)
        let a = CompanySession(id: UUID(), accountID: "company-a", displayName: "A", isOwner: false)
        let b = CompanySession(id: UUID(), accountID: "company-b", displayName: "B", isOwner: false)
        let dir = root.appendingPathComponent("workspace")
        let admin = WorkspaceStore(session: owner, directory: dir)
        let first = WorkspaceCompany(id: a.id, name: "A")
        let second = WorkspaceCompany(id: b.id, name: "B")
        try admin.saveCompany(first)
        try admin.saveCompany(second)
        let privateTask = WorkspaceTask(title: "Owner only")
        let taskA = WorkspaceTask(title: "Old A task", companyID: a.id)
        let taskB = WorkspaceTask(title: "Old B task", companyID: b.id)
        for item in [privateTask, taskA, taskB] { try admin.saveTask(item) }
        let source = root.appendingPathComponent("example.txt")
        try Data("owner record".utf8).write(to: source)
        try await admin.importDocument(from: source)
        let privateDoc = try require(admin.documents.first, "missing owner document")
        try await admin.importDocument(from: source)
        let assigned = try require(admin.documents.last, "missing document to assign")
        try admin.updateDocument(assigned.id, title: "B's contract", companyID: b.id)
        let index = dir.appendingPathComponent("workspace.json")
        var legacy = try require(JSONSerialization.jsonObject(with: Data(contentsOf: index)) as? [String: Any], "bad snapshot")
        var documents = try require(legacy["documents"] as? [[String: Any]], "bad legacy documents")
        for i in documents.indices where (documents[i]["id"] as? String)?.uppercased() == privateDoc.id.uuidString {
            documents[i].removeValue(forKey: "companyID")
        }
        legacy["documents"] = documents
        legacy.removeValue(forKey: "retiredCompanyIDs")
        try JSONSerialization.data(withJSONObject: legacy).write(to: index, options: .atomic)
        let storeA = WorkspaceStore(session: a, directory: dir)
        let storeB = WorkspaceStore(session: b, directory: dir)
        try check(storeA.companies.map(\.id) == [a.id] && storeA.tasks.map(\.id) == [taskA.id], "A saw another company or task")
        try check(storeA.documents.isEmpty && storeB.documents.map(\.id) == [assigned.id], "unassigned old files exposed")
        try denies("read B document") { _ = try storeA.documentURL(assigned) }
        try denies("read owner document") { _ = try storeA.documentURL(privateDoc) }
        try denies("update B document") { try storeA.updateDocument(assigned.id, title: "x", companyID: a.id) }
        try denies("delete B document") { try storeA.deleteDocument(assigned.id) }
        try check((try Data(contentsOf: storeB.documentURL(assigned))) == Data("owner record".utf8), "failed operation altered foreign file")
        var injected = taskB
        injected.title = "changed"; injected.companyID = a.id
        try denies("update B task") { try storeA.saveTask(injected) }
        try denies("delete B task") { try storeA.deleteTask(taskB.id) }
        try denies("add task for B") { try storeA.saveTask(WorkspaceTask(title: "foreign", companyID: b.id)) }
        try denies("write outside company profile") { try storeA.saveCompany(second) }
        try denies("delete company") { try storeA.deleteCompany(a.id) }
        try storeA.saveTask(WorkspaceTask(title: "new A task"))
        try check(storeA.tasks.first(where: { $0.title == "new A task" })?.companyID == a.id, "implicit task ownership")
        try await storeA.importDocument(from: source)
        let own = try require(storeA.documents.first, "missing A document")
        try check(own.companyID == a.id, "A's upload missing company")
        try denies("read uploaded file of A") { _ = try storeB.documentURL(own) }
        var forged = own; forged.filename = "../workspace.json"
        try denies("forged file name") { _ = try storeA.documentURL(forged) }
        try denies("reassign file across companies") { try storeA.updateDocument(own.id, title: "foreign", companyID: b.id) }
        let taskReply = try require(WorkspaceAnswers.reply(to: "اعرض المهام المفتوحة", tasks: storeA.tasks,
            documents: storeA.documents, loadingError: nil), "missing workspace answer")
        try check(taskReply.contains("Old A task") && !taskReply.contains("Old B task") &&
            !taskReply.contains("Owner only"), "assistant read another company's tasks")
        let docReply = try require(WorkspaceAnswers.reply(to: "ما أحدث ملف؟", tasks: storeA.tasks,
            documents: storeA.documents, loadingError: nil), "missing document answer")
        try check(docReply.contains("example.txt") && !docReply.contains("B's contract"), "assistant read another company's files")
        try testGuideAnswers()
        try testChats(owner: owner, a: a, b: b)
        // The sender resumes us just before import starts. It holds the main actor until
        // import suspends for its coordinated read. Keep that read blocked until logout.
        let writerRelease = DispatchSemaphore(value: 0)
        let writing = Task.detached {
            try await withCheckedThrowingContinuation { (opened: CheckedContinuation<Void, Error>) in
                DispatchQueue.global().async {
                    var issue: NSError?
                    var acquired = false
                    NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: source, options: .forReplacing,
                        error: &issue) { _ in
                        acquired = true
                        opened.resume()
                        writerRelease.wait()
                    }
                    if !acquired {
                        if let issue { opened.resume(throwing: issue) }
                        else { opened.resume(throwing: CheckFailed(description: "file coordination unavailable")) }
                    }
                }
            }
        }
        try await writing.value
        var delayedImport: Task<Void, Error>?
        await withCheckedContinuation { (started: CheckedContinuation<Void, Never>) in
            delayedImport = Task { @MainActor in
                started.resume()
                try await storeA.importDocument(from: source)
            }
        }
        storeA.lock()
        writerRelease.signal()
        let pending = try require(delayedImport, "missing import task")
        do {
            try await pending.value
            throw CheckFailed(description: "import committed after session was locked")
        } catch let failure as CheckFailed { throw failure }
          catch { /* revocation discarded the staged file */ }
        try check(storeA.companies.isEmpty && storeA.tasks.isEmpty && storeA.documents.isEmpty, "session list survived logout")
        try denies("write after logout") { try storeA.saveTask(WorkspaceTask(title: "late task")) }
        try denies("file read after logout") { _ = try storeA.documentURL(own) }
        do {
            try await storeA.importDocument(from: source)
            throw CheckFailed(description: "file imported after logout")
        } catch is CheckFailed { throw CheckFailed(description: "file imported after logout") }
          catch { /* store rejected locked session */ }
        let ownerAgain = WorkspaceStore(session: owner, directory: dir)
        try check(ownerAgain.companies.count == 2 && ownerAgain.tasks.count == 4 && ownerAgain.documents.count == 3, "owner snapshot lost foreign writes")
        try ownerAgain.deleteCompany(a.id)
        let retired = WorkspaceStore(session: a, directory: dir)
        try check(retired.loadingError != nil && retired.tasks.isEmpty, "retired account resurrected")
        print("PASS: two-company isolation, legacy ownership, task and file access, logout, retirement, chat history, preferences and Arabic answers")
    }

    @MainActor private static func testChats(owner: CompanySession, a: CompanySession, b: CompanySession) throws {
        let suite = "com.aoosgpt.regression." + UUID().uuidString
        let defaults = try require(UserDefaults(suiteName: suite), "could not open isolated defaults")
        defer { defaults.removePersistentDomain(forName: suite) }
        let legacy = ChatArchive(key: "aoosgpt.interface.history.v1", defaults: defaults)
        guard case .saved = legacy.saveExchange("old owner chat", answer: "private answer", generated: false, to: nil) else {
            throw CheckFailed(description: "owner chat fixture")
        }
        let pOwner = WorkspacePreferences(session: owner, defaults: defaults)
        let pA = WorkspacePreferences(session: a, defaults: defaults)
        let pB = WorkspacePreferences(session: b, defaults: defaults)
        try check(ChatArchive(key: pOwner.historyKey, defaults: defaults).threads.count == 1, "owner lost old conversations")
        let archiveA = ChatArchive(key: pA.historyKey, defaults: defaults)
        let archiveB = ChatArchive(key: pB.historyKey, defaults: defaults)
        try check(archiveA.threads.isEmpty && archiveB.threads.isEmpty, "old conversations visible to company")
        guard case let .saved(id) = archiveA.saveExchange("ask A", answer: "A answer", generated: false, to: nil) else {
            throw CheckFailed(description: "company A chat save")
        }
        guard case .missingThread = archiveB.saveExchange("foreign", answer: "no", generated: false, to: id) else {
            throw CheckFailed(description: "other account can continue A's chat")
        }
        pA.autoSpeak = true
        pA.displayName = "private A"
        let restoredB = WorkspacePreferences(session: b, defaults: defaults)
        try check(!restoredB.autoSpeak && restoredB.displayName != "private A", "company preferences leaked")
        try check(ChatArchive(key: pB.historyKey, defaults: defaults).threads.isEmpty, "chat persisted across company boundary")
        archiveA.lock()
        try check(archiveA.threads.isEmpty, "locked chat retained messages")
        guard case .storageUnavailable = archiveA.saveExchange("late answer", answer: "no", generated: false, to: nil) else {
            throw CheckFailed(description: "late chat saved after logout")
        }
        let restoredA = ChatArchive(key: pA.historyKey, defaults: defaults)
        try check(restoredA.threads.count == 1 && restoredA.threads.first?.id == id, "A's archived conversation changed")
    }

    @MainActor private static func testGuideAnswers() throws {
        let cases = [
            ("كيف أوثّق عقد العمل في قوى؟", "قوى", "hrsd.gov.sa"),
            ("كيف أرفع ملف حماية الأجور في مدد؟", "مدد", "hrsd.gov.sa"),
            ("ما خطوات تجديد الرخصة التجارية عبر بلدي؟", "بلدي", "momah.gov.sa"),
            ("كيف أسجل مشتركًا في التأمينات؟", "التأمينات", "gosi.gov.sa"),
            ("كيف أعدل بيانات السجل التجاري؟", "المركز السعودي للأعمال", "mc.gov.sa")
        ]
        for (question, provider, host) in cases {
            let answer = try require(GuideAnswers.reply(to: question), "unanswered guide: " + question)
            try check(answer.contains(provider) && answer.contains(host) && answer.contains("https://") && answer.contains("• "),
                      "missing provider or official source: " + question)
        }
        for question in ["ما ملفاتي؟", "اكتب خطابًا عن توثيق عقد العمل في قوى",
                         "كم رسوم تجديد الرخصة التجارية؟", "متى آخر موعد لرفع ملف حماية الأجور؟",
                         "كيف أجدد رخصة القيادة؟"] {
            try check(GuideAnswers.reply(to: question) == nil, "unexpected guidance: " + question)
        }
    }

    static func check(_ predicate: @autoclosure () throws -> Bool, _ detail: String) throws {
        guard try predicate() else { throw CheckFailed(description: detail) }
    }

    static func require<T>(_ optional: T?, _ detail: String) throws -> T {
        guard let value = optional else { throw CheckFailed(description: detail) }
        return value
    }

    static func denies(_ label: String, _ operation: () throws -> Void) throws {
        do { try operation() } catch { return }
        throw CheckFailed(description: "unexpectedly allowed: " + label)
    }
}
