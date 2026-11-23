import AVFoundation
import Combine
import Foundation
import Speech

/// Owns the microphone and speaker for the lifetime of one open chat.
@MainActor
final class AssistantVoice: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    @Published private(set) var readingID: UUID?
    @Published private(set) var dictating = false
    @Published private(set) var preparing = false
    @Published private(set) var transcript = ""
    @Published private(set) var message: String?

    private let synthesizer = AVSpeechSynthesizer()
    private var currentUtterance: AVSpeechUtterance?
    private let engine = AVAudioEngine()
    private var speechRequest: SFSpeechAudioBufferRecognitionRequest?
    private var speechTask: SFSpeechRecognitionTask?
    private var recognizer: SFSpeechRecognizer?
    private var captureID: UUID?
    private var tapInstalled = false
    private var awaitingFinal = false
    private var limit: Task<Void, Never>?
    #if os(iOS)
    private var previousSession: (AVAudioSession.Category, AVAudioSession.Mode, AVAudioSession.CategoryOptions)?
    #endif

    override init() {
        super.init()
        synthesizer.delegate = self
        #if os(iOS)
        synthesizer.usesApplicationAudioSession = false
        #endif
    }

    func read(_ text: String, id: UUID) {
        let replaying = readingID == id
        stopAll()
        message = nil
        guard !replaying else { return }
        let voice = AVSpeechSynthesisVoice(language: "ar-SA")
            ?? AVSpeechSynthesisVoice.speechVoices().first { $0.language.hasPrefix("ar") }
        guard let voice else {
            message = "يتطلب سماع الإجابة صوتًا عربيًا. يمكنك إضافته من إعدادات تسهيلات الاستخدام في النظام."
            return
        }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = voice
        currentUtterance = utterance
        readingID = id
        synthesizer.speak(utterance)
    }

    func stopReading() {
        currentUtterance = nil
        readingID = nil
        synthesizer.stopSpeaking(at: .immediate)
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in
            guard let self, self.currentUtterance === utterance else { return }
            self.currentUtterance = nil
            self.readingID = nil
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        speechSynthesizer(synthesizer, didFinish: utterance)
    }

    func startDictation() {
        guard captureID == nil else { return }
        stopReading()
        transcript = ""
        message = nil
        let locales = ["ar-SA", "ar-AE", "ar", "ar-EG"]
        guard let recognizer = locales.compactMap({ SFSpeechRecognizer(locale: Locale(identifier: $0)) })
            .first(where: { $0.supportsOnDeviceRecognition && $0.isAvailable }) else {
            message = "الإملاء العربي على الجهاز غير متاح حاليًا. اكتب سؤالك في حقل الرسالة."
            return
        }
        let id = UUID()
        captureID = id
        preparing = true
        Task { @MainActor [weak self] in
            let speechPermission: SFSpeechRecognizerAuthorizationStatus = await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
            }
            guard let self, self.captureID == id else { return }
            guard speechPermission == .authorized else {
                self.failCapture("يتطلب الإملاء إذن التعرف على الكلام. يمكنك تفعيله من إعدادات الخصوصية أو كتابة السؤال.")
                return
            }
            let microphone = await AVCaptureDevice.requestAccess(for: .audio)
            guard self.captureID == id else { return }
            guard microphone else {
                self.failCapture("يتطلب الإملاء إذن الميكروفون. يمكنك تفعيله من إعدادات الخصوصية أو كتابة السؤال.")
                return
            }
            do {
                try self.beginCapture(recognizer, id: id)
            } catch {
                self.failCapture("تعذّر بدء الإملاء. تحقق من اتصال الميكروفون أو اكتب سؤالك.")
            }
        }
    }

    private func beginCapture(_ recognizer: SFSpeechRecognizer, id: UUID) throws {
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        previousSession = (session.category, session.mode, session.categoryOptions)
        try session.setCategory(.record, mode: .measurement)
        try session.setActive(true)
        #endif
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw CocoaError(.featureUnsupported)
        }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        self.recognizer = recognizer
        speechRequest = request
        // This closure runs on a real-time audio thread, outside the UI actor.
        Self.attachTap(to: input, format: format, request: request)
        tapInstalled = true
        engine.prepare()
        try engine.start()
        preparing = false
        dictating = true
        speechTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            let words = result?.bestTranscription.formattedString
            let final = result?.isFinal == true
            let failed = error != nil
            Task { @MainActor in
                guard let self, self.captureID == id else { return }
                if let words, !words.isEmpty { self.transcript = words }
                if failed || final {
                    self.stopDictation()
                    if self.transcript.isEmpty { self.message = "لم يُلتقط كلام واضح. حاول الإملاء مرة أخرى أو اكتب سؤالك." }
                }
            }
        }
        limit = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 55_000_000_000)
            guard !Task.isCancelled, let self, self.captureID == id else { return }
            self.stopDictation()
            self.message = "انتهى وقت الإملاء. راجع النص وأرسله عندما تكون جاهزًا."
        }
    }

    nonisolated private static func attachTap(to input: AVAudioInputNode, format: AVAudioFormat,
                                              request: SFSpeechAudioBufferRecognitionRequest) {
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }
    }

    private func failCapture(_ explanation: String) {
        stopDictation()
        message = explanation
    }

    /// Stop recording immediately, and allow the recognizer to deliver its final words.
    func finishDictation() {
        guard let id = captureID, dictating, !awaitingFinal else { return }
        awaitingFinal = true
        stopMicrophone()
        speechRequest?.endAudio()
        limit?.cancel()
        limit = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard !Task.isCancelled, let self, self.captureID == id else { return }
            self.stopDictation()
        }
    }

    func stopDictation() {
        captureID = nil
        limit?.cancel()
        limit = nil
        stopMicrophone()
        if !awaitingFinal { speechRequest?.endAudio() }
        awaitingFinal = false
        speechTask?.cancel()
        speechTask = nil
        speechRequest = nil
        recognizer = nil
        preparing = false
        dictating = false
    }

    private func stopMicrophone() {
        if engine.isRunning { engine.stop() }
        if tapInstalled {
            engine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        #if os(iOS)
        if let previousSession {
            let session = AVAudioSession.sharedInstance()
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            try? session.setCategory(previousSession.0, mode: previousSession.1, options: previousSession.2)
            self.previousSession = nil
        }
        #endif
    }

    func stopAll() {
        stopDictation()
        stopReading()
    }

    func clearNotice() { message = nil }
}
