import SwiftUI
import QuickLook
import UniformTypeIdentifiers

private let workspaceAccent = Color(red: 0.09, green: 0.46, blue: 0.39)

private struct WorkspaceHeader: View {
    let title: String
    let symbol: String
    let actionTitle: String
    let actionSymbol: String
    let action: () -> Void

    private var heading: some View {
        Label(title, systemImage: symbol).font(.title2.bold())
    }

    private var actionButton: some View {
        Button(action: action) { Label(actionTitle, systemImage: actionSymbol) }
            .buttonStyle(.borderedProminent).tint(workspaceAccent)
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack { heading; Spacer(minLength: 20); actionButton }
            VStack(alignment: .leading, spacing: 10) { heading; actionButton }
        }.padding(.horizontal).padding(.top, 12)
    }
}

private struct WorkspaceEmpty: View {
    let symbol: String
    let text: String
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: symbol).font(.largeTitle).foregroundStyle(workspaceAccent)
            Text(text).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity).padding(24)
    }
}

private struct WorkspaceNotice: View {
    let text: String?
    var body: some View {
        if let text {
            Label(text, systemImage: "exclamationmark.triangle")
                .font(.callout).foregroundStyle(.primary).padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.orange.opacity(0.13), in: RoundedRectangle(cornerRadius: 9))
                .padding(.horizontal)
        }
    }
}

private struct WorkspaceSearch: View {
    let prompt: String
    @Binding var text: String
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
            TextField(prompt, text: $text).textFieldStyle(.plain)
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill") }
                    .buttonStyle(.borderless).accessibilityLabel("مسح البحث")
            }
        }
        .padding(10)
        .background(Color.secondary.opacity(0.10), in: RoundedRectangle(cornerRadius: 9))
        .padding(.horizontal)
    }
}

private struct WorkspaceForm<Fields: View>: View {
    var title: String
    var disabled: Bool
    var save: () throws -> Void
    @ViewBuilder var fields: () -> Fields
    @Environment(\.dismiss) private var dismiss
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title).font(.title2.bold()).padding()
            WorkspaceNotice(text: error)
            Form { fields() }.formStyle(.grouped)
            Divider()
            HStack {
                Button("إلغاء") { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                Button("حفظ") {
                    do { try save(); dismiss() }
                    catch { self.error = error.localizedDescription }
                }.buttonStyle(.borderedProminent).tint(workspaceAccent)
                    .keyboardShortcut(.defaultAction).disabled(disabled)
            }.padding()
        }
        #if os(macOS)
        .frame(minWidth: 400, idealWidth: 490, minHeight: 360, idealHeight: 450)
        #endif
        .environment(\.layoutDirection, .rightToLeft)
    }
}

private func containsQuery(_ query: String, in values: [String]) -> Bool {
    let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
    return query.isEmpty || values.contains { $0.localizedCaseInsensitiveContains(query) }
}

struct CompaniesPanel: View {
    @EnvironmentObject private var store: WorkspaceStore
    @State private var search = ""
    @State private var editor: WorkspaceCompany?
    @State private var showAccountSetup = false
    @State private var pendingDelete: WorkspaceCompany?
    @State private var error: String?

    private var items: [WorkspaceCompany] {
        store.companies.filter { containsQuery(search, in: [$0.name, $0.registration, $0.city, $0.notes]) }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    var body: some View {
        VStack(spacing: 12) {
            if store.session.isOwner {
                WorkspaceHeader(title: "المنشآت", symbol: "building.2", actionTitle: "إضافة منشأة", actionSymbol: "plus") {
                    editor = WorkspaceCompany()
                }
                Button { showAccountSetup = true } label: {
                    Label("إعداد دخول شركة", systemImage: "key")
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal)
                WorkspaceSearch(prompt: "ابحث باسم المنشأة أو المدينة أو السجل", text: $search)
            } else {
                Label("بيانات الشركة", systemImage: "building.2")
                    .font(.title2.bold())
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal).padding(.top, 12)
            }
            WorkspaceNotice(text: store.loadingError ?? error)
            if items.isEmpty {
                WorkspaceEmpty(symbol: "building.2", text: store.companies.isEmpty
                    ? (store.session.isOwner ? "أضف منشأتك الأولى لحفظ بياناتها وربط المهام بها." : "تعذّر عرض سجل شركتك.")
                    : "لم نعثر على منشأة تطابق بحثك.")
            } else {
                List(items) { item in
                    HStack(spacing: 12) {
                        Image(systemName: "building.2.fill").foregroundStyle(workspaceAccent).accessibilityHidden(true)
                        Button { editor = item } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.name).font(.headline)
                                let detail = [item.city, item.registration].filter { !$0.isEmpty }.joined(separator: " · ")
                                if !detail.isEmpty { Text(detail).font(.subheadline).foregroundStyle(.secondary) }
                                if !item.notes.isEmpty { Text(item.notes).lineLimit(2).font(.caption).foregroundStyle(.secondary) }
                            }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                        Menu {
                            Button("تعديل") { editor = item }
                            if store.session.isOwner {
                                Button("حذف", role: .destructive) { pendingDelete = item }
                            }
                        } label: { Image(systemName: "ellipsis.circle") }
                        .menuStyle(.borderlessButton).fixedSize().accessibilityLabel("خيارات " + item.name)
                    }.padding(.vertical, 5)
                }.listStyle(.plain)
            }
        }
        .sheet(item: $editor) { CompanyEditor(item: $0).environmentObject(store) }
        .sheet(isPresented: $showAccountSetup) {
            CreateCompanyAccountView().environmentObject(store)
        }
        .alert("حذف المنشأة؟", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }), presenting: pendingDelete) { item in
            Button("إلغاء", role: .cancel) {}
            Button("حذف", role: .destructive) {
                do { try store.deleteCompany(item.id); error = nil }
                catch { self.error = error.localizedDescription }
            }
        } message: { item in Text("ستُغلق مساحة «" + item.name + "» على هذا الجهاز. ستبقى مهامها وملفاتها متاحة للمالك فقط.") }
    }
}

private struct CompanyEditor: View {
    @EnvironmentObject private var store: WorkspaceStore
    @State var item: WorkspaceCompany
    var body: some View {
        WorkspaceForm(title: store.companies.contains(where: { $0.id == item.id }) ? "تعديل المنشأة" : "منشأة جديدة",
                      disabled: item.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      save: { try store.saveCompany(item) }) {
            Section("بيانات المنشأة") {
                TextField("اسم المنشأة", text: $item.name)
                TextField("رقم السجل (اختياري)", text: $item.registration)
                TextField("المدينة (اختياري)", text: $item.city)
            }
            Section("ملاحظات") {
                TextField("أضف ملاحظة", text: $item.notes, axis: .vertical).lineLimit(2...6)
            }
        }
    }
}

private enum TaskFilter: String, CaseIterable, Identifiable {
    case active = "قيد المتابعة", done = "مكتملة", all = "الكل"
    var id: Self { self }
}

struct TasksPanel: View {
    @EnvironmentObject private var store: WorkspaceStore
    @State private var filter = TaskFilter.active
    @State private var search = ""
    @State private var editor: WorkspaceTask?
    @State private var pendingDelete: WorkspaceTask?
    @State private var error: String?

    private var items: [WorkspaceTask] {
        store.tasks.filter { item in
            let company = store.companies.first { $0.id == item.companyID }?.name ?? ""
            return (filter == .all || item.isDone == (filter == .done))
                && containsQuery(search, in: [item.title, item.notes, company])
        }.sorted {
            if $0.due == $1.due { return $0.title.localizedStandardCompare($1.title) == .orderedAscending }
            return $0.due < $1.due
        }
    }

    var body: some View {
        VStack(spacing: 12) {
            WorkspaceHeader(title: "المهام والمواعيد", symbol: "checklist", actionTitle: "إضافة مهمة", actionSymbol: "plus") {
                var task = WorkspaceTask()
                if !store.session.isOwner { task.companyID = store.session.id }
                editor = task
            }
            Picker("حالة المهمة", selection: $filter) {
                ForEach(TaskFilter.allCases) { Text($0.rawValue).tag($0) }
            }.pickerStyle(.segmented).padding(.horizontal)
            WorkspaceSearch(prompt: "ابحث بعنوان المهمة أو المنشأة", text: $search)
            WorkspaceNotice(text: store.loadingError ?? error)
            if items.isEmpty {
                WorkspaceEmpty(symbol: "checklist", text: store.tasks.isEmpty ? "أضف مهمة وحدّد موعدها لتتابعها هنا." : "لا توجد مهام ضمن هذا الاختيار.")
            } else {
                List(items) { item in
                    HStack(spacing: 12) {
                        Button {
                            var update = item
                            update.isDone.toggle()
                            do { try store.saveTask(update); error = nil }
                            catch { self.error = error.localizedDescription }
                        } label: {
                            Image(systemName: item.isDone ? "checkmark.circle.fill" : "circle")
                                .font(.title3).foregroundStyle(workspaceAccent)
                        }.buttonStyle(.borderless).accessibilityLabel(item.isDone ? "إعادة المهمة إلى المتابعة" : "تحديد المهمة كمكتملة")
                        Button { editor = item } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.title).font(.headline).strikethrough(item.isDone)
                                Label(item.due.formatted(date: .abbreviated, time: .omitted), systemImage: "calendar")
                                    .font(.caption).foregroundStyle(.secondary)
                                if let company = store.companies.first(where: { $0.id == item.companyID }) {
                                    Text(company.name).font(.caption).foregroundStyle(.secondary)
                                }
                                if !item.isDone && Calendar.current.compare(item.due, to: Date(), toGranularity: .day) == .orderedAscending {
                                    Text("تجاوزت الموعد").font(.caption.bold()).foregroundStyle(.orange)
                                }
                            }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                        Menu {
                            Button("تعديل") { editor = item }
                            Button("حذف", role: .destructive) { pendingDelete = item }
                        } label: { Image(systemName: "ellipsis.circle") }
                        .menuStyle(.borderlessButton).fixedSize().accessibilityLabel("خيارات " + item.title)
                    }.padding(.vertical, 5)
                }.listStyle(.plain)
            }
        }
        .sheet(item: $editor) { TaskEditor(item: $0).environmentObject(store) }
        .alert("حذف المهمة؟", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }), presenting: pendingDelete) { item in
            Button("إلغاء", role: .cancel) {}
            Button("حذف", role: .destructive) {
                do { try store.deleteTask(item.id); error = nil }
                catch { self.error = error.localizedDescription }
            }
        } message: { item in Text(item.title) }
    }
}

private struct TaskEditor: View {
    @EnvironmentObject private var store: WorkspaceStore
    @State var item: WorkspaceTask
    var body: some View {
        WorkspaceForm(title: store.tasks.contains(where: { $0.id == item.id }) ? "تعديل المهمة" : "مهمة جديدة",
                      disabled: item.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      save: { try store.saveTask(item) }) {
            Section("تفاصيل المهمة") {
                TextField("عنوان المهمة", text: $item.title)
                DatePicker("الموعد", selection: $item.due, displayedComponents: .date)
                if store.session.isOwner {
                    Picker("المنشأة", selection: $item.companyID) {
                        Text("خاصة بالمالك").tag(Optional<UUID>.none)
                        ForEach(store.companies) { Text($0.name).tag(Optional($0.id)) }
                    }
                }
                Toggle("مكتملة", isOn: $item.isDone)
            }
            Section("ملاحظات") {
                TextField("أضف ملاحظة", text: $item.notes, axis: .vertical).lineLimit(2...6)
            }
        }
    }
}

struct DocumentsPanel: View {
    @EnvironmentObject private var store: WorkspaceStore
    @State private var search = ""
    @State private var showImporter = false
    @State private var importing = false
    @State private var preview: URL?
    @State private var editing: WorkspaceDocument?
    @State private var pendingDelete: WorkspaceDocument?
    @State private var error: String?

    private var items: [WorkspaceDocument] {
        store.documents.filter { containsQuery(search, in: [$0.title, $0.filename]) }.sorted { $0.added > $1.added }
    }

    var body: some View {
        VStack(spacing: 12) {
            WorkspaceHeader(title: "أرشيف الملفات", symbol: "folder", actionTitle: "استيراد ملف", actionSymbol: "square.and.arrow.down") {
                showImporter = true
            }.disabled(importing || store.loadingError != nil)
            WorkspaceSearch(prompt: "ابحث باسم الملف أو عنوانه", text: $search)
            WorkspaceNotice(text: store.loadingError ?? error)
            if importing { ProgressView("جارٍ نسخ الملف…").padding(6) }
            if items.isEmpty {
                WorkspaceEmpty(symbol: "folder", text: store.documents.isEmpty ? "استورد مستندًا للاحتفاظ بنسخة منه داخل التطبيق." : "لم نعثر على ملف يطابق بحثك.")
            } else {
                List(items) { item in
                    HStack(spacing: 12) {
                        Image(systemName: "doc.fill").font(.title3).foregroundStyle(workspaceAccent).accessibilityHidden(true)
                        Button {
                            do { preview = try store.documentURL(item); error = nil }
                            catch { self.error = error.localizedDescription }
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.title).font(.headline).lineLimit(2)
                                if item.filename != item.title { Text(item.filename).font(.caption).foregroundStyle(.secondary) }
                                if store.session.isOwner {
                                    Label(store.companies.first(where: { $0.id == item.companyID })?.name ?? "خاص بالمالك",
                                          systemImage: item.companyID == nil ? "lock" : "building.2")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Text(item.added.formatted(date: .abbreviated, time: .omitted) + " · " + ByteCountFormatter.string(fromByteCount: item.size, countStyle: .file))
                                    .font(.caption).foregroundStyle(.secondary)
                            }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                        }.buttonStyle(.plain).accessibilityHint("معاينة الملف")
                        if let url = try? store.documentURL(item) {
                            ShareLink(item: url) { Image(systemName: "square.and.arrow.up") }
                                .buttonStyle(.borderless).accessibilityLabel("مشاركة نسخة من الملف")
                        }
                        Menu {
                            Button(store.session.isOwner ? "تعديل بيانات الملف" : "تعديل العنوان") { editing = item }
                            Button("حذف", role: .destructive) { pendingDelete = item }
                        } label: { Image(systemName: "ellipsis.circle") }
                        .menuStyle(.borderlessButton).fixedSize().accessibilityLabel("خيارات " + item.title)
                    }.padding(.vertical, 5)
                }.listStyle(.plain)
            }
        }
        .quickLookPreview($preview)
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.data]) { result in
            switch result {
            case .success(let url):
                importing = true
                Task {
                    defer { importing = false }
                    do { try await store.importDocument(from: url); error = nil }
                    catch { self.error = error.localizedDescription }
                }
            case .failure(let failure):
                if (failure as NSError).code != NSUserCancelledError { error = failure.localizedDescription }
            }
        }
        .sheet(item: $editing) { DocumentEditor(item: $0).environmentObject(store) }
        .alert("حذف النسخة المؤرشفة؟", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }), presenting: pendingDelete) { item in
            Button("إلغاء", role: .cancel) {}
            Button("حذف", role: .destructive) {
                do { try store.deleteDocument(item.id); error = nil }
                catch { self.error = error.localizedDescription }
            }
        } message: { item in Text("ستُحذف نسخة «" + item.title + "» من الأرشيف. يبقى الملف الأصلي في مكانه.") }
    }
}

private struct DocumentEditor: View {
    @EnvironmentObject private var store: WorkspaceStore
    @State var item: WorkspaceDocument
    var body: some View {
        WorkspaceForm(title: store.session.isOwner ? "تعديل بيانات الملف" : "تعديل عنوان الملف",
                      disabled: item.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      save: { try store.updateDocument(item.id, title: item.title, companyID: item.companyID) }) {
            TextField("العنوان في الأرشيف", text: $item.title)
            LabeledContent("اسم الملف الأصلي", value: item.filename)
            if store.session.isOwner {
                Section {
                    Picker("إتاحة الملف", selection: $item.companyID) {
                        Text("خاص بالمالك").tag(Optional<UUID>.none)
                        ForEach(store.companies) { Text($0.name).tag(Optional($0.id)) }
                    }
                } footer: {
                    Text("تستطيع الشركة المختارة معاينة هذا الملف من حسابها على الجهاز.")
                }
            }
        }
    }
}
