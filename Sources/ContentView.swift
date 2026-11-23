import SwiftUI

enum Destination: String, Hashable, CaseIterable, Identifiable {
    case home, chat, tasks, companies, documents, guides, templates, settings
    var id: Self { self }

    var title: String {
        switch self {
        case .home: return "الرئيسية"
        case .chat: return "المساعد"
        case .tasks: return "المهام والمواعيد"
        case .companies: return "المنشآت"
        case .documents: return "ملفاتي"
        case .guides: return "دليل الخدمات"
        case .templates: return "قوالب الخطابات"
        case .settings: return "الإعدادات"
        }
    }

    var symbol: String {
        switch self {
        case .home: return "rectangle.grid.2x2"
        case .chat: return "bubble.left.and.bubble.right"
        case .tasks: return "checklist"
        case .companies: return "building.2"
        case .documents: return "folder"
        case .guides: return "book"
        case .templates: return "doc.on.doc"
        case .settings: return "gearshape"
        }
    }
}

private struct NavigateKey: FocusedValueKey {
    typealias Value = (Destination) -> Void
}

extension FocusedValues {
    var navigateWorkspace: ((Destination) -> Void)? {
        get { self[NavigateKey.self] }
        set { self[NavigateKey.self] = newValue }
    }
}

#if os(macOS)
struct WorkspaceCommands: Commands {
    @FocusedValue(\.navigateWorkspace) var navigate
    var body: some Commands {
        CommandMenu("مساحة العمل") {
            ForEach(Array(Destination.allCases.enumerated()), id: \.element) { index, section in
                Button(section.title) { navigate?(section) }
                    .keyboardShortcut(KeyEquivalent(Character(String(index + 1))), modifiers: [.command])
                    .disabled(navigate == nil)
            }
        }
    }
}
#endif

private let evergreen = Color(red: 0.06, green: 0.32, blue: 0.27)
private let mint = Color(red: 0.63, green: 0.89, blue: 0.69)

struct ContentView: View {
    @EnvironmentObject private var workspace: WorkspaceStore
    @EnvironmentObject private var access: CompanyAccess
    @State private var section: Destination? = .home
    @State private var chatPrompt: String?
    @State private var chatKey = UUID()
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    private func sectionTitle(_ destination: Destination) -> String {
        destination == .companies && !workspace.session.isOwner ? "ملف المنشأة" : destination.title
    }

    var body: some View {
        Group {
            #if os(iOS)
            if sizeClass == .compact {
                NavigationStack {
                    detail
                        .navigationTitle(sectionTitle(section ?? .home))
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .navigationBarTrailing) {
                                accountMenu
                            }
                            ToolbarItem(placement: .navigationBarLeading) {
                                Menu {
                                    ForEach(Destination.allCases) { destination in
                                        Button { navigate(destination) } label: {
                                            Label(sectionTitle(destination), systemImage: destination.symbol)
                                        }
                                    }
                                } label: { Label("أقسام التطبيق", systemImage: "sidebar.right") }
                                .accessibilityLabel("أقسام التطبيق")
                            }
                        }
                }
            } else {
                columns
            }
            #else
            columns
            #endif
        }
        .tint(Color("BrandAccent"))
        .focusedSceneValue(\.navigateWorkspace, navigate)
    }

    private var accountMenu: some View {
        Menu {
            Text(workspace.session.displayName)
            Button { navigate(.settings) } label: { Label("إعدادات الحساب", systemImage: "gearshape") }
            Button { access.logout() } label: { Label("تسجيل الخروج", systemImage: "rectangle.portrait.and.arrow.right") }
        } label: {
            Label("حسابي", systemImage: workspace.session.isOwner ? "person.crop.circle.badge.checkmark" : "person.crop.circle")
        }.accessibilityLabel("قائمة حساب " + workspace.session.displayName)
    }

    private var columns: some View {
        NavigationSplitView {
            List(selection: Binding<Destination?>(
                get: { section },
                set: { if let destination = $0 { navigate(destination) } }
            )) {
                HStack(spacing: 10) {
                    Image("BrandPortrait").resizable().aspectRatio(contentMode: .fill)
                        .frame(width: 35, height: 35).clipShape(RoundedRectangle(cornerRadius: 9))
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(verbatim: "AoosGPT").font(.title2.bold())
                        Text(workspace.session.displayName).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                .padding(.vertical, 12)
                sidebarSection("مساحة العمل", [.home, .chat, .tasks, .companies, .documents])
                sidebarSection("المعرفة", [.guides, .templates])
                Section {
                    Label(Destination.settings.title, systemImage: Destination.settings.symbol)
                        .tag(Destination.settings)
                    accountMenu
                }
            }
            .listStyle(.sidebar)
            .navigationSplitViewColumnWidth(min: 200, ideal: 235, max: 285)
        } detail: {
            detail.navigationTitle(sectionTitle(section ?? .home))
        }
        .navigationSplitViewStyle(.balanced)
    }

    private func sidebarSection(_ title: String, _ destinations: [Destination]) -> some View {
        Section {
            ForEach(destinations) { destination in
                Label(sectionTitle(destination), systemImage: destination.symbol).tag(destination)
            }
        } header: { Text(title) }
    }

    @ViewBuilder private var detail: some View {
        switch section ?? .home {
        case .home: HomePanel(navigate: navigate, newChat: { startChat("") })
        case .chat: ChatPanel(initialPrompt: chatPrompt).id(chatKey)
        case .companies: CompaniesPanel()
        case .tasks: TasksPanel()
        case .documents: DocumentsPanel()
        case .guides: GuidesPanel { startChat($0) }
        case .templates: TemplatesPanel { startChat($0) }
        case .settings: PreferencesPanel()
        }
    }

    private func navigate(_ destination: Destination) {
        chatPrompt = nil
        section = destination
    }

    private func startChat(_ prompt: String?) {
        chatPrompt = prompt
        chatKey = UUID()
        section = .chat
    }
}

private struct HomePanel: View {
    @EnvironmentObject private var workspace: WorkspaceStore
    @Environment(\.colorScheme) private var scheme
    @EnvironmentObject private var preferences: WorkspacePreferences
    let navigate: (Destination) -> Void
    let newChat: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 0) {
                        welcomeText.frame(minWidth: 270, maxWidth: .infinity, alignment: .leading)
                        portrait.frame(width: 194, height: 202)
                    }
                    .background(evergreen)
                    .clipShape(RoundedRectangle(cornerRadius: 18))
                    HStack(spacing: 0) {
                        welcomeText
                        Spacer(minLength: 0)
                    }
                    .background(evergreen)
                    .clipShape(RoundedRectangle(cornerRadius: 18))
                }

                if let error = workspace.loadingError {
                    Label(error, systemImage: "exclamationmark.triangle").font(.callout)
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text("مساحة العمل").font(.title3.bold())
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 135), spacing: 12)], spacing: 12) {
                        metric(.tasks, workspace.openTaskCount, "مهام مفتوحة")
                        if workspace.session.isOwner {
                            metric(.companies, workspace.companies.count, "منشآت مسجلة")
                        }
                        metric(.documents, workspace.documents.count, "ملفات محفوظة")
                    }
                }

                HStack(alignment: .firstTextBaseline) {
                    Text("أقرب المواعيد").font(.title3.bold())
                    Spacer()
                    Button("عرض المهام") { navigate(.tasks) }.buttonStyle(.borderless)
                }
                if upcoming.isEmpty {
                    Label("ستظهر هنا مواعيد المهام التي تضيفها.", systemImage: "calendar")
                        .font(.callout).foregroundStyle(.secondary)
                } else {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(upcoming) { task in
                            Button { navigate(.tasks) } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: "calendar").foregroundStyle(Color("BrandAccent"))
                                    Text(task.title).lineLimit(2)
                                    Spacer()
                                    Text(task.due, style: .date).font(.callout).foregroundStyle(.secondary)
                                }.padding(.vertical, 10).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                            Divider()
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text("الأدلة والخطابات").font(.title3.bold())
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 218), spacing: 12)], spacing: 12) {
                        resource(.guides, "قوائم تحقق وروابط الجهات الرسمية")
                        resource(.templates, "حرّر خطابًا وانسخ نسخته النهائية")
                    }
                }
            }
            .frame(maxWidth: 1060, alignment: .leading)
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .center)
        }
    }

    private var upcoming: [WorkspaceTask] {
        Array(workspace.tasks.filter { !$0.isDone }.sorted { $0.due < $1.due }.prefix(3))
    }

    private var portrait: some View {
        GeometryReader { proxy in
            Image("BrandPortrait").resizable().scaledToFill()
                .frame(width: proxy.size.width, height: proxy.size.height, alignment: .top)
                .clipped().accessibilityHidden(true)
        }
    }

    private var welcomeText: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(verbatim: "AoosGPT").font(.system(.subheadline, design: .monospaced).weight(.semibold))
                .foregroundStyle(mint)
            Text(preferences.displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "أهلًا بك" : "أهلًا، " + preferences.displayName)
                .font(.system(.largeTitle, design: .rounded).bold())
                .fixedSize(horizontal: false, vertical: true)
            Button(action: newChat) {
                Label("اسأل المساعد", systemImage: "waveform")
                    .font(.headline).foregroundStyle(evergreen)
                    .padding(.horizontal, 13).padding(.vertical, 8)
                    .background(.white, in: Capsule())
            }.buttonStyle(.plain)
        }
        .padding(22).foregroundStyle(.white)
    }

    private var cardBackground: Color { Color.secondary.opacity(scheme == .dark ? 0.14 : 0.07) }

    private func metric(_ item: Destination, _ count: Int, _ caption: String) -> some View {
        Button { navigate(item) } label: {
            VStack(alignment: .leading, spacing: 7) {
                Image(systemName: item.symbol).foregroundStyle(Color("BrandAccent"))
                Text(count, format: .number).font(.title.bold()).monospacedDigit()
                Text(caption).font(.callout).foregroundStyle(.secondary)
            }
            .padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .background(cardBackground, in: RoundedRectangle(cornerRadius: 12))
        }.buttonStyle(.plain).accessibilityElement(children: .combine)
    }

    private func resource(_ item: Destination, _ description: String) -> some View {
        Button { navigate(item) } label: {
            HStack(spacing: 12) {
                Image(systemName: item.symbol).font(.title3).foregroundStyle(Color("BrandAccent"))
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title).font(.headline)
                    Text(description).font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.forward").font(.caption).foregroundStyle(.secondary)
            }
            .padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .background(cardBackground, in: RoundedRectangle(cornerRadius: 12))
        }.buttonStyle(.plain)
    }
}

private struct PreferencesPanel: View {
    @EnvironmentObject private var preferences: WorkspacePreferences
    @EnvironmentObject private var store: WorkspaceStore
    @EnvironmentObject private var access: CompanyAccess
    @State private var showCreation = false
    var body: some View {
        Form {
            Section("الحساب") {
                LabeledContent(store.session.isOwner ? "حساب المالك" : "حساب الشركة", value: store.session.displayName)
                LabeledContent("معرّف الدخول", value: store.session.accountID)
                if store.session.isOwner {
                    Button { showCreation = true } label: { Label("إنشاء حساب شركة", systemImage: "building.2.crop.circle") }
                }
                Button("تسجيل الخروج") { access.logout() }
            }
            Section("المساعد المتحدث") {
                Toggle("قراءة الإجابات الجديدة بصوت مسموع", isOn: $preferences.autoSpeak)
            }
            Section("تخصيص الواجهة") {
                TextField("اسم العرض", text: $preferences.displayName)
                Picker("المظهر", selection: $preferences.appearance) {
                    Text("تلقائي").tag("system")
                    Text("فاتح").tag("light")
                    Text("داكن").tag("dark")
                }
            }
            Section("بيانات التطبيق") {
                Label("تُحفظ المحادثات وسجلات العمل على هذا الجهاز.", systemImage: "internaldrive")
                if let url = URL(string: "https://aoosgpt-privacy.mn8-sh5.chatgpt.site/") {
                    Link(destination: url) { Label("سياسة الخصوصية", systemImage: "hand.raised") }
                }
            }
        }
        .formStyle(.grouped)
        .sheet(isPresented: $showCreation) {
            if store.session.isOwner {
                CreateCompanyAccountView()
                    .environmentObject(access)
                    .environmentObject(store)
                    .environment(\.layoutDirection, .rightToLeft)
            }
        }
    }
}
