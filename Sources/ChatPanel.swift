import Foundation
import SwiftUI
#if canImport(FoundationModels)
import FoundationModels
#endif
#if os(macOS)
import AppKit
#elseif os(iOS)
import UIKit
#endif

@MainActor
struct ChatPanel: View {
    let initialPrompt: String?
    @EnvironmentObject private var archive: ChatArchive
    @EnvironmentObject private var workspace: WorkspaceStore
    @StateObject private var voice = AssistantVoice()
    @State private var dictationPrefix = ""
    @EnvironmentObject private var preferences: WorkspacePreferences
    @State private var selectedID: UUID?
    @State private var draft = ""
    @State private var showingHistory = false
    @Environment(\.scenePhase) private var scenePhase
    @State private var usesModel = false
    @State private var modelUnavailable: String?
    @State private var notice: String?
    @State private var generation: Task<Void, Never>?
    @State private var requestID: UUID?
    @State private var loaded = false
    @FocusState private var focused: Bool

    init(initialPrompt: String? = nil) {
        self.initialPrompt = initialPrompt
    }

    private var conversation: ChatThread? {
        archive.threads.first { $0.id == selectedID }
    }

    private var canSend: Bool {
        generation == nil && !voice.preparing && !voice.dictating && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && draft.count <= 4000
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            conversationView
            Divider()
            composer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            refreshAvailability()
            guard !loaded else { return }
            loaded = true
            usesModel = (initialPrompt ?? "").isEmpty && modelUnavailable == nil
            if let prompt = initialPrompt {
                prepare(prompt)
            } else {
                selectedID = archive.threads.first?.id
            }
        }
        .onDisappear {
            cancelGeneration()
            voice.stopAll()
        }
        .onChange(of: voice.transcript) { words in
            guard !words.isEmpty else { return }
            draft = String((dictationPrefix + words).prefix(4000))
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active { refreshAvailability() }
            if phase == .background {
                cancelGeneration()
                voice.stopAll()
            }
        }
        .onChange(of: initialPrompt) { prompt in
            if let prompt = prompt {
                prepare(prompt)
            } else {
                cancelGeneration()
                voice.stopAll()
                voice.clearNotice()
                notice = nil
                draft = ""
                selectedID = archive.threads.first?.id
            }
        }
        .sheet(isPresented: $showingHistory) {
            ChatHistory(archive: archive, activeID: selectedID) { thread in
                cancelGeneration()
                voice.stopAll()
                voice.clearNotice()
                notice = nil
                draft = ""
                selectedID = thread.id
            }
            .environment(\.layoutDirection, .rightToLeft)
        }
        .alert("تنبيه سجل المحادثات", isPresented: Binding(
            get: { archive.error != nil },
            set: { if !$0 { archive.error = nil } }
        )) {
            Button("حسنًا", role: .cancel) { archive.error = nil }
        } message: {
            Text(archive.error ?? "")
        }
    }

    private var voiceStatus: String? {
        if voice.preparing { return "جارٍ تجهيز الميكروفون" }
        if voice.dictating { return "أستمع إلى سؤالك" }
        if voice.readingID != nil { return "أقرأ الإجابة بصوت مسموع" }
        if generation != nil { return "جارٍ إعداد الإجابة" }
        return nil
    }

    private var header: some View {
        HStack(spacing: 12) {
            Group {
                if voice.readingID != nil {
                    Button { voice.stopReading() } label: {
                        Image(systemName: "stop.fill")
                    }.buttonStyle(.plain)
                        .accessibilityLabel("إيقاف قراءة الإجابة")
                } else {
                    Image(systemName: voice.dictating ? "mic.fill" : "waveform")
                        .accessibilityHidden(true)
                }
            }
            .font(.title3.weight(.semibold))
            .foregroundStyle(Color("BrandAccent"))
            .frame(width: 44, height: 44)
            .background(Color("BrandAccent").opacity(0.12), in: Circle())
            VStack(alignment: .leading, spacing: 3) {
                Text("المساعد المتحدث")
                    .font(.title3.bold())
                    .accessibilityAddTraits(.isHeader)
                Text(voiceStatus ?? conversation?.title ?? "محادثة جديدة")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Button {
                focused = false
                voice.stopAll()
                showingHistory = true
            } label: {
                Image(systemName: "clock.arrow.circlepath")
                    .frame(width: 40, height: 40)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("المحادثات المحفوظة")
            .help("المحادثات المحفوظة")
            Button {
                cancelGeneration()
                voice.stopAll()
                voice.clearNotice()
                notice = nil
                selectedID = nil
                draft = ""
                focused = true
            } label: {
                Image(systemName: "square.and.pencil")
                    .frame(width: 40, height: 40)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("محادثة جديدة")
            .help("محادثة جديدة")
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 8)
        .frame(maxWidth: 870)
        .frame(maxWidth: .infinity)
    }

    private var conversationView: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
                    if let thread = conversation, !thread.messages.isEmpty {
                        ForEach(thread.messages) { message in
                            ChatBubble(message: message, reading: voice.readingID == message.id) {
                                voice.read(message.spokenText, id: message.id)
                            }
                                .id(message.id)
                        }
                    } else {
                        welcome
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 22)
                .frame(maxWidth: 830, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .onAppear {
                if let last = conversation?.messages.last?.id {
                    proxy.scrollTo(last, anchor: .bottom)
                }
            }
            .onChange(of: conversation?.messages.last?.id) { last in
                if let last = last { proxy.scrollTo(last, anchor: .bottom) }
            }
        }
    }

    private var welcome: some View {
        let name = preferences.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        return VStack(alignment: .leading, spacing: 16) {
            Text(name.isEmpty ? "كيف أساعدك اليوم؟" : "كيف أساعدك اليوم يا \(name)؟")
                .font(.title.bold())
                .accessibilityAddTraits(.isHeader)
            Text(usesModel ? "اسأل عن مهام الشركة وملفاتها، أو اطرح سؤالًا عامًا على نموذج Apple. يمكنك سماع الإجابة بالعربية." : "اسأل عن مهام الشركة وملفاتها أو اختر قالبًا لصياغة مسودة. يمكنك سماع الإجابة بالعربية.")
                .font(.body)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 8) {
                Button {
                    prepare("ما المهام المفتوحة؟")
                } label: {
                    Label("ما المهام المفتوحة؟", systemImage: "checklist")
                }
                Button {
                    prepare("كيف أوثّق عقد العمل في قوى؟")
                } label: {
                    Label("كيف أوثّق عقد العمل في قوى؟", systemImage: "doc.text")
                }
            }
            .buttonStyle(.bordered)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 190), spacing: 10)], spacing: 10) {
                ForEach(ChatAction.allCases, id: \.self) { action in
                    Button {
                        usesModel = false
                        prepare(action.prompt)
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: action.icon)
                                .foregroundStyle(Color.accentColor)
                                .frame(width: 25)
                                .accessibilityHidden(true)
                            Text(action.title)
                                .font(.headline)
                                .multilineTextAlignment(.leading)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 0)
                        }
                        .padding(14)
                        .background(Color.accentColor.opacity(0.07), in: RoundedRectangle(cornerRadius: 14))
                        .contentShape(RoundedRectangle(cornerRadius: 14))
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("يفتح نموذجًا قابلًا للتعديل في حقل الرسالة")
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Menu {
                    Button("بيانات الشركة والقوالب") {
                        usesModel = false
                        notice = nil
                    }
                    Button("نموذج Apple على الجهاز") {
                        refreshAvailability()
                        if let reason = modelUnavailable {
                            notice = reason
                        } else {
                            usesModel = true
                            notice = nil
                        }
                    }
                } label: {
                    Label(usesModel ? "نموذج Apple" : "مساعد الشركة", systemImage: "slider.horizontal.3")
                }
                .fixedSize()
                .disabled(generation != nil)
                Spacer()
                Toggle(isOn: $preferences.autoSpeak) {
                    Image(systemName: preferences.autoSpeak ? "speaker.wave.2.fill" : "speaker.slash")
                }
                .toggleStyle(.button)
                .accessibilityLabel("قراءة الإجابات الجديدة تلقائيًا")
                .help("قراءة الإجابات الجديدة تلقائيًا")
                .onChange(of: preferences.autoSpeak) { enabled in
                    if !enabled { voice.stopReading() }
                }
                if generation != nil {
                    ProgressView().controlSize(.small)
                    Button("إلغاء التوليد") {
                        cancelGeneration()
                        notice = "أُلغي التوليد. يمكنك تعديل الرسالة أو إرسالها مجددًا."
                    }
                }
            }
            if let notice = voice.message ?? notice {
                Text(notice).font(.footnote).foregroundStyle(.secondary)
            }
            HStack(alignment: .bottom, spacing: 10) {
                TextField("اكتب رسالتك…", text: $draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...6)
                    .padding(12)
                    .focused($focused)
                    .disabled(generation != nil || voice.preparing || voice.dictating)
                    .accessibilityLabel("نص الرسالة")
                    .background(.background, in: RoundedRectangle(cornerRadius: 13))
                    .overlay(RoundedRectangle(cornerRadius: 13).strokeBorder(Color.secondary.opacity(0.3)))
                Button {
                    if voice.preparing { voice.stopDictation() }
                    else if voice.dictating { voice.finishDictation() }
                    else {
                        dictationPrefix = draft.isEmpty || draft.last?.isWhitespace == true ? draft : draft + " "
                        focused = false
                        voice.startDictation()
                    }
                } label: {
                    Image(systemName: voice.dictating || voice.preparing ? "stop.fill" : "mic")
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.borderless)
                .disabled(generation != nil || draft.count >= 4000 && !voice.dictating && !voice.preparing)
                .accessibilityLabel(voice.dictating || voice.preparing ? "إيقاف الإملاء" : "إملاء سؤال بالعربية")
                .help("إملاء سؤال بالعربية")
                Button {
                    send()
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.headline)
                        .frame(width: 42, height: 42)
                        .foregroundStyle(.white)
                        .background(canSend ? Color(red: 0.05, green: 0.37, blue: 0.30) : Color.secondary,
                                    in: RoundedRectangle(cornerRadius: 13))
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
                .keyboardShortcut(.return, modifiers: .command)
                .accessibilityLabel("إرسال الرسالة")
                .help("إرسال الرسالة (⌘↩)")
            }
            Text(voice.dictating ? "الميكروفون يعمل. اضغط إيقاف ثم راجع سؤالك." : voice.preparing ? "جارٍ تجهيز الإملاء…" : draft.count > 4000 ? "اختصر الرسالة إلى ٤٠٠٠ حرف قبل الإرسال." : "تُعالَج رسائلك على هذا الجهاز")
                .font(.caption)
                .foregroundStyle(draft.count > 4000 ? Color.red : Color.secondary)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .frame(maxWidth: 830)
        .frame(maxWidth: .infinity)
    }

    private func prepare(_ prompt: String) {
        cancelGeneration()
        voice.stopAll()
        voice.clearNotice()
        notice = nil
        selectedID = nil
        draft = prompt
        focused = true
    }

    private func refreshAvailability() {
        modelUnavailable = LocalLanguageModel.unavailableReason
        if usesModel, let reason = modelUnavailable {
            usesModel = false
            notice = reason
        }
    }

    private func cancelGeneration() {
        generation?.cancel()
        generation = nil
        requestID = nil
    }

    private func send() {
        guard canSend else { return }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let context = conversation?.messages ?? []
        let target = selectedID
        voice.stopAll()
        voice.clearNotice()
        notice = nil
        if let answer = WorkspaceAnswers.reply(to: text, tasks: workspace.tasks, documents: workspace.documents,
                                              loadingError: workspace.loadingError) ?? GuideAnswers.reply(to: text) {
            finish(archive.saveExchange(text, answer: answer, generated: false, to: target))
            return
        }
        guard usesModel else {
            let answer = ChatAction.answer(text, context: context)
            finish(archive.saveExchange(text, answer: answer, generated: false, to: target))
            return
        }

        if let reason = LocalLanguageModel.unavailableReason {
            refreshAvailability()
            notice = reason
            return
        }
        let token = UUID()
        requestID = token
        generation = Task { @MainActor in
            defer {
                if requestID == token {
                    generation = nil
                    requestID = nil
                }
            }
            do {
                let answer = try await LocalLanguageModel.reply(to: text, context: context)
                try Task.checkCancellation()
                guard requestID == token else { return }
                finish(archive.saveExchange(text, answer: answer, generated: true, to: target))
            } catch {
                guard requestID == token, !Task.isCancelled else { return }
                notice = "تعذّر توليد الرد على الجهاز. بقيت رسالتك هنا. يمكنك اختصارها والمحاولة مجددًا أو اختيار القوالب المحلية."
            }
        }
    }

    private func finish(_ result: ChatSaveResult) {
        switch result {
        case .saved(let id):
            if preferences.autoSpeak, scenePhase == .active,
               let reply = archive.threads.first(where: { $0.id == id })?.messages.last {
                voice.read(reply.spokenText, id: reply.id)
            }
            selectedID = id
            draft = ""
        case .missingThread:
            selectedID = nil
            notice = "حُذفت المحادثة. بقيت رسالتك هنا، ويمكنك إرسالها مجددًا لبدء محادثة جديدة."
        case .storageUnavailable:
            notice = "لم يُحفظ الرد. بقيت رسالتك في حقل الكتابة لتنسخها أو تعيد المحاولة."
        }
    }

}

private struct ChatBubble: View {
    let message: ChatMessage
    let reading: Bool
    let play: () -> Void
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(message.role == .user ? "أنت" : (message.generatedOnDevice == true ? "AoosGPT · نموذج Apple" : "AoosGPT · مساعد الشركة"), systemImage: message.role == .user ? "person" : "text.bubble")
                .font(.caption.bold())
                .foregroundStyle(.secondary)
            Text(verbatim: message.spokenText)
                .lineSpacing(4)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let source = message.guideSource {
                Link(destination: source) {
                    Label("فتح المصدر الرسمي", systemImage: "arrow.up.right.square")
                }
            }
            if message.role == .assistant {
                HStack(spacing: 18) {
                    Button(action: play) {
                        Label(reading ? "إيقاف القراءة" : "اسمع الرد", systemImage: reading ? "stop.circle.fill" : "speaker.wave.2")
                            .font(.caption)
                            .padding(.vertical, 5)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Color.accentColor)
                    Button {
                        #if os(macOS)
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(message.text, forType: .string)
                        #elseif os(iOS)
                        UIPasteboard.general.string = message.text
                        #endif
                        copied = true
                    } label: {
                        Label(copied ? "تم النسخ" : "نسخ الرد", systemImage: copied ? "checkmark" : "doc.on.doc")
                            .font(.caption)
                            .padding(.vertical, 5)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Color.accentColor)
                }
            }
        }
        .padding(14)
        .background(message.role == .user ? Color.accentColor.opacity(0.08) : Color.secondary.opacity(0.07),
                    in: RoundedRectangle(cornerRadius: 14))
    }
}

@MainActor
private struct ChatHistory: View {
    @ObservedObject var archive: ChatArchive
    let activeID: UUID?
    let select: (ChatThread) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var pendingDeletion: ChatThread?

    private var matches: [ChatThread] {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !term.isEmpty else { return archive.threads }
        return archive.threads.filter { thread in
            thread.title.localizedCaseInsensitiveContains(term) || thread.messages.contains {
                $0.text.localizedCaseInsensitiveContains(term)
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("المحادثات المحفوظة").font(.title2.bold())
                Spacer()
                Button("تم") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
            TextField("بحث في المحادثات", text: $query)
                .textFieldStyle(.roundedBorder)
            if matches.isEmpty {
                Text(archive.threads.isEmpty ? "تظهر محادثتك هنا بعد إرسال أول رسالة." : "لا توجد محادثة تطابق البحث.")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(matches) { thread in
                    HStack {
                        Button {
                            select(thread)
                            dismiss()
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(thread.title).font(.headline).lineLimit(2)
                                Text(thread.updatedAt, style: .date)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 6)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if activeID == thread.id {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(Color.accentColor)
                                .accessibilityLabel("المحادثة المفتوحة")
                        }
                        Button {
                            pendingDeletion = thread
                        } label: {
                            Image(systemName: "trash")
                                .frame(width: 40, height: 40)
                                .foregroundStyle(.red)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("حذف المحادثة \(thread.title)")
                    }
                }
                .listStyle(.plain)
            }
        }
        .padding(18)
        #if os(macOS)
        .frame(minWidth: 390, idealWidth: 480, minHeight: 350, idealHeight: 420)
        #endif
        .alert("حذف المحادثة؟", isPresented: Binding(get: { pendingDeletion != nil }, set: {
            if !$0 { pendingDeletion = nil }
        }), presenting: pendingDeletion) { thread in
            Button("حذف", role: .destructive) { archive.delete(thread.id) }
            Button("إلغاء", role: .cancel) {}
        } message: { thread in
            Text("سيُحذف «\(thread.title)» من سجل هذا الجهاز.")
        }
    }
}

// The stored schema and defaults key also decode conversations created by the original SwiftUI app.
enum ChatRole: String, Codable { case user, assistant }

struct ChatMessage: Identifiable, Codable {
    var id = UUID()
    var role: ChatRole
    var text: String
    var generatedOnDevice: Bool? = nil

    var guideSource: URL? { role == .assistant ? GuideAnswers.source(in: text) : nil }

    var spokenText: String {
        guard let source = guideSource else { return text }
        let lines = text.components(separatedBy: .newlines)
        guard let last = lines.last, last.contains(source.absoluteString) else { return text }
        return lines.dropLast().joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

struct ChatThread: Identifiable, Codable {
    var id = UUID()
    var title: String
    var messages: [ChatMessage] = []
    var updatedAt = Date()
}

enum ChatSaveResult {
    case saved(UUID)
    case missingThread
    case storageUnavailable
}

@MainActor
final class ChatArchive: ObservableObject {
    private let defaults: UserDefaults
    @Published private(set) var threads: [ChatThread] = []
    @Published var error: String?
    private let key: String
    private var writable = true

    init(key: String, defaults: UserDefaults = .standard) {
        self.key = key
        self.defaults = defaults
        guard let stored = defaults.object(forKey: key) else { return }
        guard let data = stored as? Data else {
            writable = false
            error = "تعذّر قراءة صيغة سجل المحادثات. احتُفظ بالسجل السابق دون تعديل."
            return
        }
        do {
            threads = try JSONDecoder().decode([ChatThread].self, from: data)
        } catch {
            writable = false
            self.error = "تعذّر فتح سجل المحادثات. احتُفظ بالسجل السابق دون تعديل."
        }
    }

    func lock() {
        writable = false
        threads = []
        error = nil
    }

    func saveExchange(_ text: String, answer: String, generated: Bool, to id: UUID?) -> ChatSaveResult {
        var list = threads
        var thread = ChatThread(title: String(text.prefix(42)))
        if let id = id {
            // Another window may have deleted this chat during on-device generation.
            guard let index = list.firstIndex(where: { $0.id == id }) else { return .missingThread }
            thread = list.remove(at: index)
        }
        thread.messages.append(ChatMessage(role: .user, text: text))
        thread.messages.append(ChatMessage(role: .assistant, text: answer, generatedOnDevice: generated))
        thread.updatedAt = Date()
        list.insert(thread, at: 0)
        return persist(list) ? .saved(thread.id) : .storageUnavailable
    }

    func delete(_ id: UUID) {
        _ = persist(threads.filter { $0.id != id })
    }

    private func persist(_ next: [ChatThread]) -> Bool {
        guard writable else {
            error = "تعذّر تحديث السجل السابق. بقيت بياناته الأصلية محفوظة دون تعديل."
            return false
        }
        do {
            let data = try JSONEncoder().encode(next)
            defaults.set(data, forKey: key)
            guard defaults.data(forKey: key) == data else {
                error = "تعذّر تأكيد حفظ المحادثة على الجهاز."
                return false
            }
            threads = next
            return true
        } catch {
            self.error = "تعذّر حفظ التغييرات الأخيرة في سجل المحادثات."
            return false
        }
    }
}

private enum LocalLanguageModel {
    static var unavailableReason: String? {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, macOS 26.0, *) {
            let model = SystemLanguageModel.default
            switch model.availability {
            case .available:
                return model.supportsLocale(Locale(identifier: "ar")) ? nil : "نموذج Apple المثبّت على جهازك لا يدعم العربية حاليًا. يمكنك استخدام القوالب المحلية."
            case .unavailable(.deviceNotEligible):
                return "هذا الجهاز لا يدعم نموذج Apple. القوالب المحلية متاحة."
            case .unavailable(.appleIntelligenceNotEnabled):
                return "شغّل Apple Intelligence من إعدادات الجهاز لاستخدام نموذج Apple عند توفر العربية."
            case .unavailable(.modelNotReady):
                return "نموذج Apple قيد التجهيز. أعد المحاولة بعد اكتمال تنزيله من إعدادات النظام."
            default:
                return "نموذج Apple غير متاح على هذا الجهاز حاليًا. القوالب المحلية متاحة."
            }
        }
        #endif
        return "يتطلب نموذج Apple إصدارًا يدعم Apple Intelligence من النظام والتطبيق. يمكنك استخدام القوالب المحلية."
    }

    enum Failure: Error { case unavailable }

    static func reply(to text: String, context: [ChatMessage]) async throws -> String {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, macOS 26.0, *), unavailableReason == nil {
            let session = LanguageModelSession(instructions: """
                أجب بالعربية. ساعد في صياغة النصوص وترتيب المهام. لا تدّعِ التحقق من منصة أو إرسال معاملة.
                عند سؤال عن حكم نظامي أو موعد رسمي، اطلب الرجوع إلى المصدر المختص.
                """)
            let history = context.suffix(4).map { message in
                let role = message.role == .user ? "المستخدم" : "المساعد"
                return "\(role): \(message.text.prefix(400))"
            }.joined(separator: "\n")
            let prompt = history.isEmpty ? text : "السياق السابق:\n\(history)\n\nطلب المستخدم الحالي:\n\(text)"
            let response = try await session.respond(to: prompt)
            return response.content
        }
        #endif
        throw Failure.unavailable
    }
}

private enum ChatAction: CaseIterable {
    case letter, followUp, documents, meeting

    var title: String {
        switch self {
        case .letter: return "صياغة خطاب"
        case .followUp: return "تنظيم متابعة"
        case .documents: return "قائمة مستندات"
        case .meeting: return "محضر اجتماع"
        }
    }

    var icon: String {
        switch self {
        case .letter: return "doc.text"
        case .followUp: return "calendar.badge.clock"
        case .documents: return "checklist"
        case .meeting: return "person.2"
        }
    }

    var prompt: String {
        switch self {
        case .letter: return "صياغة خطاب\nالجهة: \nالموضوع: \nالطلب: "
        case .followUp: return "متابعة معاملة\nالموضوع: \nالحالة: \nالإجراء التالي: \nالمسؤول: "
        case .documents: return "قائمة مستندات\nالموضوع: \nالمستندات: "
        case .meeting: return "محضر اجتماع\nالموضوع: \nالحضور: \nالقرار: \nالإجراء التالي: "
        }
    }

    private static func intent(for text: String) -> ChatAction? {
        let subject = normalize(text.components(separatedBy: .newlines).first ?? text)
        if subject.contains("خطاب") || subject.contains("رسمي") { return .letter }
        if subject.contains("اجتماع") || subject.contains("محضر") { return .meeting }
        if ["مستند", "وثائق", "قائمه", "امتثال", "قائمة", "ملفات"].contains(where: { subject.contains($0) }) { return .documents }
        if ["معامل", "متابع", "طلب", "مهمة", "تجديد"].contains(where: { subject.contains($0) }) { return .followUp }
        return nil
    }

    private static func normalize(_ text: String) -> String {
        text.replacingOccurrences(of: "[أإآ]", with: "ا", options: .regularExpression)
            .replacingOccurrences(of: "[\\u064B-\\u065F\\u0670]", with: "", options: .regularExpression)
            .replacingOccurrences(of: "ـ", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func fields(in text: String) -> [String: String] {
        var values = [String: String]()
        for line in text.components(separatedBy: .newlines) {
            guard let separator = line.firstIndex(where: { $0 == ":" || $0 == "：" }) else { continue }
            let name = normalize(String(line[..<separator]))
            let value = String(line[line.index(after: separator)...]).trimmingCharacters(in: .whitespaces)
            if !name.isEmpty && !value.isEmpty { values[name] = value }
        }
        return values
    }

    private static func startsWithField(_ text: String) -> Bool {
        let firstLine = text.components(separatedBy: .newlines).first ?? ""
        let names = ["الجهة", "الموضوع", "الطلب", "مقدم الطلب", "الحالة", "الرقم المرجعي",
                     "الإجراء التالي", "المسؤول", "الموعد", "المستندات", "المصدر", "التاريخ", "الحضور", "القرار"]
        return !Set(fields(in: firstLine).keys).isDisjoint(with: names.map(normalize))
    }

    static func answer(_ text: String, context: [ChatMessage]) -> String {
        if let newline = text.firstIndex(of: "\n") {
            let heading = normalize(String(text[..<newline]))
            let body = String(text[text.index(after: newline)...])
            if !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                if heading == "مراجعة خطاب" {
                    let openFields = body.contains("[") && body.contains("]")
                    let reminder = openFields ? "استكمل الحقول بين الأقواس قبل إرسال الخطاب." : "راجع اسم المستلم والموضوع والتوقيع قبل الإرسال."
                    return "\(body)\n\nملاحظة للمراجعة: \(reminder)"
                }
                if heading == "قائمة تحقق" {
                    return "\(body)\n\nللمتابعة: ضع ✓ بجوار كل بند بعد التحقق منه، وسجّل تاريخ آخر مراجعة."
                }
            }
        }
        var values = fields(in: text)
        var action = intent(for: text)
        if startsWithField(text) {
            action = nil
            // A field-only follow-up edits the current template, including changes from earlier turns.
            for earlier in context.reversed() where earlier.role == .user {
                values = fields(in: earlier.text).merging(values) { _, latest in latest }
                if !startsWithField(earlier.text) {
                    action = intent(for: earlier.text)
                    break
                }
            }
        }
        guard let action = action else {
            return "أستطيع الإجابة عن مهام هذه الشركة وأسماء ملفاتها المحفوظة، أو تجهيز خطاب ومحضر اجتماع. جرّب «ما المهام المتأخرة؟» أو «ما أحدث ملف؟». للأسئلة العامة اختر نموذج Apple إذا كان متاحًا على جهازك."
        }
        func field(_ name: String, _ fallback: String) -> String {
            values[normalize(name)] ?? fallback
        }
        let heading = text.components(separatedBy: .newlines).first ?? ""
        let topicPhrase = ["بشأن ", "بخصوص ", "بشأنّ ", "عن موضوع "].compactMap {
            heading.range(of: $0).map { String(heading[$0.upperBound...]).trimmingCharacters(in: .whitespaces) }
        }.first { !$0.isEmpty }
        let topic = field("الموضوع", field(action.title, topicPhrase ?? "[الموضوع]"))
        switch action {
        case .letter:
            return """
            إلى \(field("الجهة", "[الجهة المستلمة]"))
            الموضوع: \(topic)

            السلام عليكم ورحمة الله وبركاته،
            نأمل منكم التكرم بالنظر في الطلب الآتي:
            \(field("الطلب", "[اكتب الطلب وأسبابه]"))

            وتفضلوا بقبول التحية والتقدير.
            \(field("مقدم الطلب", "[مقدم الطلب]"))
            """
        case .followUp:
            return """
            بطاقة متابعة • \(topic)

            الحالة الحالية: \(field("الحالة", "[قيد المتابعة]"))
            الرقم المرجعي: \(field("الرقم المرجعي", "[يُضاف عند توفره]"))
            الإجراء التالي: \(field("الإجراء التالي", "[حدّد خطوة واحدة قابلة للتنفيذ]"))
            المسؤول: \(field("المسؤول", "[اسم المسؤول]"))
            موعد المتابعة: \(field("الموعد", "[حدّد التاريخ]"))
            """
        case .documents:
            let items = field("المستندات", "").components(separatedBy: CharacterSet(charactersIn: "،,؛;"))
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            let list = items.isEmpty ? "☐ [اسم المستند الأول]\n☐ [اسم المستند الثاني]" : items.map { "☐ \($0)" }.joined(separator: "\n")
            return "قائمة مراجعة • \(topic)\n\n\(list)\n\nمصدر القائمة: \(field("المصدر", "[رابط الجهة أو مرجعها]"))\nتاريخ التحقق: \(field("التاريخ", "[التاريخ]"))"
        case .meeting:
            return """
            محضر اجتماع • \(topic)

            التاريخ: \(field("التاريخ", "[تاريخ الاجتماع]"))
            الحضور: \(field("الحضور", "[أسماء الحضور]"))
            القرار: \(field("القرار", "[القرار المتفق عليه]"))
            الإجراء التالي: \(field("الإجراء التالي", "[المهمة وموعد إنجازها]"))
            المسؤول: \(field("المسؤول", "[صاحب المهمة]"))
            """
        }
    }
}

// Match questions about saved workspace records before asking a model to generate an answer.
enum WorkspaceAnswers {
    static func reply(to text: String, tasks: [WorkspaceTask], documents: [WorkspaceDocument],
                      loadingError: String?, now: Date = Date(), calendar: Calendar = .current) -> String? {
        // A multi-line message is an editable draft template from the composer.
        guard !text.contains("\n") else { return nil }
        let query = text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "ar"))
            .replacingOccurrences(of: "[أإآ]", with: "ا", options: .regularExpression)
            .replacingOccurrences(of: "ـ", with: "")
            .replacingOccurrences(of: "ة", with: "ه")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        func has(_ phrases: [String]) -> Bool { phrases.contains { query.contains($0) } }
        if has(["من انت", "ماذا تفعل", "كيف استخدم المساعد", "ماذا تستطيع", "كيف تساعدني"]) {
            return "أنا مساعد مساحة الشركة. اسألني مثلًا «ما المهام المتأخرة؟» أو «ما أحدث ملف؟». يمكنك إملاء السؤال، مراجعته، ثم إرساله وسماع الرد. تتوفر الإجابات العامة عند تشغيل نموذج Apple المدعوم."
        }
        if has(["كيف اسمع", "كيف استمع", "كيف انطق الرد"]) {
            return "اضغط «اسمع الرد» أسفل إجابة المساعد. لقراءة الإجابات الجديدة تلقائيًا، فعّل زر السماعة بجانب اختيار المساعد."
        }
        if has(["كيف اضيف ملف", "كيف ارفع ملف", "كيف استورد ملف"]) {
            return "افتح صفحة الملفات في مساحة الشركة، ثم اختر استيراد ملف وحدد المستند من جهازك. بعد إضافته يمكنك أن تسألني عن أحدث ملف محفوظ."
        }
        if has(["كيف اضيف مهمه", "كيف اسجل مهمه", "كيف انشئ مهمه"]) {
            return "انتقل إلى صفحة المهام في مساحة الشركة وأضف مهمة جديدة. أدخل عنوانها وحدد الموعد ثم احفظها. اسألني بعدها عن مهام اليوم أو المهام المفتوحة."
        }
        let asksAboutTasks = has(["مهام", "مهمه"])
        let asksAboutFiles = has(["ملف", "وثائق", "مستند", "ارشيف"])
        let aboutCompany = has(["الشركه", "شركتي", "مساح", "محفوظ", "مسجل"])
        let overview = has(["ملخص", "موجز"]) && aboutCompany
        let overdue = has(["متاخر", "فات موعد", "تجاوز"])
        let today = has(["اليوم"])
        let tomorrow = has(["غدا", "بكره"])
        let open = has(["مفتوح", "متبقي", "معلق", "غير مكتمل", "لم تكتمل", "قيد التنفيذ"])
        let done = has(["مكتمل", "منجز", "انتهت", "انجز"]) && !open
        let latest = has(["احدث", "اخر", "اجدد"])
        let count = has(["كم عدد", "كم ملف", "كم مهمه", "كم لدي", "كم عند", "كم مستند", "كم وثيق"])
        let askForList = has(["اعرض", "اذكر", "ما هي", "ماهي", "ما المهام", "ما الملفات", "وش", "ايش", "قائمه المهام", "مهامي", "ملفاتي"])
        let asksForSavedFiles = has(["ملفاتي", "ما الملفات", "ما هي الملفات", "ماهي الملفات", "اعرض الملفات", "الملفات المتاحه"])
        guard overview || (asksAboutTasks && (count || open || done || overdue || today || tomorrow || askForList))
                || (asksAboutFiles && (count || latest || (askForList && (aboutCompany || asksForSavedFiles)))) else {
            return nil
        }
        if loadingError != nil { return "تعذّرت قراءة سجلات مساحة العمل. افتح صفحة المهام أو الملفات وراجع رسالة التحميل ثم أعد المحاولة." }
        if overview {
            return "في مساحة الشركة الحالية \(tasks.filter { !$0.isDone }.count) مهمة مفتوحة، و\(tasks.filter { $0.isDone }.count) مهمة مكتملة، و\(documents.count) ملف محفوظ."
        }
        if asksAboutTasks {
            let day = calendar.startOfDay(for: now)
            let nextDay = calendar.date(byAdding: .day, value: 1, to: day) ?? day
            let matched = tasks.filter { task in
                if overdue && (task.isDone || task.due >= day) { return false }
                if (open && task.isDone) || (done && !task.isDone) { return false }
                if today && !calendar.isDate(task.due, inSameDayAs: now) { return false }
                if tomorrow && !calendar.isDate(task.due, inSameDayAs: nextDay) { return false }
                return true
            }.sorted { $0.due < $1.due }
            guard !matched.isEmpty else { return "لم أعثر على مهام تطابق سؤالك في مساحة الشركة الحالية." }
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "ar_SA")
            formatter.calendar = calendar
            formatter.dateStyle = .medium
            return listing(matched.map { "\($0.title) — \(formatter.string(from: $0.due))" },
                           heading: "عدد المهام المطابقة في مساحة الشركة: \(matched.count)", limit: count ? 0 : 5)
        }
        guard !documents.isEmpty else { return "أرشيف الشركة الحالية فارغ. يمكنك استيراد مستند من صفحة الملفات." }
        let sorted = documents.sorted { $0.added > $1.added }
        if latest { return "أحدث ملف أُضيف إلى مساحة الشركة هو «\(sorted[0].title)»." }
        return listing(sorted.map(\.title), heading: "عدد الملفات المحفوظة في مساحة الشركة: \(sorted.count)", limit: count ? 0 : 5)
    }

    private static func listing(_ lines: [String], heading: String, limit: Int) -> String {
        guard limit > 0 else { return heading + "." }
        var pieces = [heading] + lines.prefix(limit).map { "• " + $0 }
        if lines.count > limit { pieces.append("أعرض أول \(limit) نتائج.") }
        return pieces.joined(separator: "\n")
    }
}
