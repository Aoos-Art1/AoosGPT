import Combine
import SwiftUI

@MainActor
final class WorkspacePreferences: ObservableObject {
    @Published var displayName: String {
        didSet { defaults.set(displayName, forKey: keyPrefix + "displayName") }
    }
    @Published var appearance: String {
        didSet { defaults.set(appearance, forKey: keyPrefix + "appearance") }
    }
    @Published var savedGuideIDs: String {
        didSet { defaults.set(savedGuideIDs, forKey: keyPrefix + "resources.favoriteGuides.v1") }
    }
    @Published var autoSpeak: Bool {
        didSet { defaults.set(autoSpeak, forKey: keyPrefix + "autoSpeak") }
    }

    private let defaults: UserDefaults
    private let keyPrefix: String
    var historyKey: String { keyPrefix + "interface.history.v1" }

    init(session: CompanySession, defaults: UserDefaults = .standard) {
        // Keep the owner's existing settings and history at their original keys.
        let keyPrefix = session.isOwner ? "aoosgpt." : "aoosgpt.company.\(session.id.uuidString)."
        self.keyPrefix = keyPrefix
        self.defaults = defaults
        displayName = defaults.string(forKey: keyPrefix + "displayName") ?? session.displayName
        appearance = defaults.string(forKey: keyPrefix + "appearance") ?? "system"
        savedGuideIDs = defaults.string(forKey: keyPrefix + "resources.favoriteGuides.v1") ?? ""
        autoSpeak = defaults.bool(forKey: keyPrefix + "autoSpeak")
    }

    var colorScheme: ColorScheme? {
        switch appearance {
        case "light": return .light
        case "dark": return .dark
        default: return nil
        }
    }
}

@MainActor
private final class OpenWorkspace {
    let session: CompanySession
    let store: WorkspaceStore
    let preferences: WorkspacePreferences
    let archive: ChatArchive

    init(session: CompanySession) {
        self.session = session
        preferences = WorkspacePreferences(session: session)
        store = WorkspaceStore(session: session)
        archive = ChatArchive(key: preferences.historyKey)
    }

    func lock() {
        store.lock()
        archive.lock()
    }
}

@MainActor
private final class ApplicationState: ObservableObject {
    let access = CompanyAccess()
    @Published private(set) var current: OpenWorkspace?
    private var observation: AnyCancellable?

    init() {
        observation = access.$session.sink { [weak self] session in
            guard let self else { return }
            self.current?.lock()
            self.current = session.map { OpenWorkspace(session: $0) }
        }
    }
}

@MainActor
private struct WorkspaceWindow: View {
    let workspace: OpenWorkspace
    @ObservedObject var preferences: WorkspacePreferences
    @ObservedObject var store: WorkspaceStore
    @EnvironmentObject private var access: CompanyAccess

    var body: some View {
        Group {
            if let error = store.loadingError {
                VStack(spacing: 18) {
                    Label("تعذّر فتح مساحة العمل", systemImage: "lock.fill").font(.title2.bold())
                    Text(error).multilineTextAlignment(.center)
                    Button("العودة إلى تسجيل الدخول") { access.logout() }.buttonStyle(.borderedProminent)
                }.padding(24)
            } else {
                ContentView()
            }
        }
            .environmentObject(store)
            .environmentObject(workspace.archive)
            .environmentObject(preferences)
            .preferredColorScheme(preferences.colorScheme)
    }
}

@main
@MainActor
struct AoosGPTApp: App {
    @StateObject private var state = ApplicationState()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup("AoosGPT") {
            Group {
                if let workspace = state.current {
                    WorkspaceWindow(workspace: workspace, preferences: workspace.preferences, store: workspace.store)
                        .id(workspace.session.id)
                } else {
                    CompanySignInView()
                }
            }
            .environmentObject(state.access)
            .environment(\.layoutDirection, .rightToLeft)
            .environment(\.locale, Locale(identifier: "ar_SA"))
            #if os(macOS)
            .frame(minWidth: 760, minHeight: 530)
            #endif
        }
        .onChange(of: scenePhase) { phase in
            if phase == .background { state.access.logout() }
            if phase == .active && state.current == nil { state.access.refreshSetupState() }
        }
        #if os(macOS)
        .defaultSize(width: 1130, height: 760)
        .commands { WorkspaceCommands() }
        #endif
    }
}
