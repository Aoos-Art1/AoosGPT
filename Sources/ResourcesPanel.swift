import SwiftUI
import Foundation
#if os(macOS)
import AppKit
#elseif os(iOS)
import UIKit
#endif

private struct ServiceGuide: Identifiable {
    let id: String
    let title: String
    let provider: String
    let symbol: String
    let keywords: String
    let checklist: [String]
    let source: URL

    var assistantPrompt: String {
        let heading = ["قائمة تحقق", "الموضوع: \(title)", "المصدر: \(source.absoluteString)"]
        return (heading + checklist.map { "☐ " + $0 }).joined(separator: "\n")
    }

    static let library: [ServiceGuide] = [
        .init(id: "qiwa-contract", title: "توثيق عقد عمل", provider: "قوى", symbol: "doc.text",
              keywords: "عقود موظف العمل Qiwa",
              checklist: ["جهّز بيانات المنشأة والموظف وبنود العقد المتفق عليها.",
                          "راجع المسمى والأجر وتاريخ المباشرة قبل إرسال العقد عبر قوى.",
                          "تابع رد الموظف ودوّن حالة العقد وتاريخ آخر إجراء."],
              source: URL(string: "https://www.hrsd.gov.sa/ministry-services/services/")!.appendingPathComponent("إدارة-العقود")),
        .init(id: "mudad-wages", title: "متابعة ملف حماية الأجور", provider: "مدد", symbol: "list.bullet.rectangle",
              keywords: "رواتب الأجور حماية بنكي WPS Mudad",
              checklist: ["حدّد المنشأة وشهر الأجور المطلوب مراجعته.",
                          "طابق ملف البنك المختوم إلكترونيًا مع مسيّر الأجور للفترة نفسها.",
                          "بعد الرفع في مدد، راجع نتيجة معالجة الملف واحفظ مرجع المتابعة."],
              source: URL(string: "https://www.hrsd.gov.sa/ministry-services/services/")!.appendingPathComponent("رفع-ملف-حماية-الأجور")),
        .init(id: "balady-license", title: "تجديد رخصة تجارية", provider: "بلدي", symbol: "building.2",
              keywords: "رخصة بلدية نشاط تراخيص Balady",
              checklist: ["حدّد الرخصة والفرع المطلوب تجديد رخصته.",
                          "طابق بيانات النشاط والموقع مع الرخصة الحالية، وراجع المطلوب في بلدي.",
                          "احفظ رقم الطلب ثم سجّل تاريخ الانتهاء من الرخصة الصادرة."],
              source: URL(string: "https://momah.gov.sa/ar/e-services/tjdyd-rkhst-tjaryt")!),
        .init(id: "gosi-contributor", title: "تسجيل مشترك", provider: "التأمينات الاجتماعية", symbol: "person.badge.plus",
              keywords: "موظف مشترك تسجيل GOSI اشتراك",
              checklist: ["حدّد المنشأة والمشترك المعني.",
                          "طابق البيانات مع سجل الموظف، وراجع متطلبات التسجيل في الدليل.",
                          "احفظ نتيجة الطلب ودوّن أي بيانات تحتاج إلى استكمال."],
              source: URL(string: "https://cmsgosi.gosi.gov.sa/eServices/Documents/AddcontributorARV2.pdf")!),
        .init(id: "business-registry", title: "تحديث بيانات السجل التجاري", provider: "المركز السعودي للأعمال", symbol: "folder",
              keywords: "تجارة شركة منشأة سجل تجاري business",
              checklist: ["حدّد رقم السجل والبيان الذي يحتاج إلى تحديث.",
                          "قارن البيانات الحالية بالمستند الذي يثبت التغيير.",
                          "اتبع دليل الخدمة واحتفظ بمرجع الطلب والنتيجة."],
              source: URL(string: "https://mc.gov.sa/ar/Documents/User-GuideMC.pdf#page=13")!)
    ]
}

private extension String {
    var resourceSearchKey: String {
        folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "ar_SA"))
            .replacingOccurrences(of: "[أإآ]", with: "ا", options: .regularExpression)
            .replacingOccurrences(of: "ـ", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

enum GuideAnswers {
    static func reply(to question: String) -> String? {
        let text = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= 180, text.rangeOfCharacter(from: .newlines) == nil else {
            return nil
        }
        let key = text.resourceSearchKey.replacingOccurrences(of: #"\p{M}"#, with: "", options: .regularExpression)
        let tokens = key.components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }
        guard tokens.count <= 25 else { return nil }
        var words = Set(tokens)
        for word in tokens {
            for prefix in ["بال", "وال", "فال", "كال", "لل", "ال", "ل"] where word.hasPrefix(prefix) {
                words.insert(String(word.dropFirst(prefix.count)))
            }
        }
        func has(_ alternatives: String...) -> Bool { !words.isDisjoint(with: alternatives) }

        // These guides contain preparation steps. Leave requests for drafting,
        // deadlines, prices, legal decisions or personal status to the other routes.
        guard !["خطاب", "رسالة", "صياغ", "اصيغ", "اكتب", "صيغ", "مسودة", "تظلم", "شكوى",
                "عقوب", "غرام", "مخالف", "تكلف", "رسوم", "تعرف", "قانون", "مهلة", "صلاحية",
                "اخر موعد", "يحق", "مسموح", "الزام", "اجباري", "الغاء", "فسخ"].contains(where: key.contains),
              !has("كم", "متى", "مدة", "موعد", "مواعيد", "سعر", "قيمة", "نسبة", "غدا", "اليوم",
                   "لماذا", "ليش", "هل", "شروط", "عقوبات", "نظاميا", "نظامية", "حالة", "عندي")
        else { return nil }
        let asksForGuide = has("كيف", "خطوات", "طريقة", "اجراءات", "دليل", "رابط", "متطلبات",
                               "تحضير", "تجهيز", "مستندات", "مطلوب", "مطلوبة", "قائمة")
        let matches = ServiceGuide.library.filter { guide in
            if key == guide.title.resourceSearchKey { return true }
            guard asksForGuide else { return false }
            switch guide.id {
            case "qiwa-contract":
                return has("توثيق", "اوثق", "نوثق", "يوثق") && has("عقد", "عقود", "عقدي") &&
                    has("عمل", "موظف", "موظفا", "توظيف", "قوى", "qiwa")
            case "mudad-wages":
                return has("حماية") && has("اجور") &&
                    has("رفع", "ارفع", "نرفع", "تحميل", "تحضير", "تجهيز", "متابعة", "اتابع", "ملف", "ملفات", "دليل", "رابط")
            case "balady-license":
                return has("تجديد", "اجدد", "نجدد") && has("رخصة", "رخصتي", "رخص", "ترخيص", "تراخيص") &&
                    has("تجارية", "تجاري", "بلدي", "بلدية", "نشاط", "balady")
            case "gosi-contributor":
                return has("تسجيل", "اسجل", "نسجل", "اضافة", "اضيف") &&
                    has("مشترك", "مشتركا", "المشتركين", "مشتركين", "موظف", "موظفا") &&
                    has("تامينات", "gosi")
            case "business-registry":
                return has("سجل", "سجلي") && has("تجاري") &&
                    has("تحديث", "احدث", "نحدث", "تعديل", "اعدل", "نعدل", "تغيير", "اغير") &&
                    has("بيانات", "بياناته", "بياناتي", "بيان")
            default: return false
            }
        }
        guard matches.count == 1, let guide = matches.first else { return nil }
        let lines = ["\(guide.title) عبر \(guide.provider)", "خطوات التحضير"] +
            guide.checklist.map { "• " + $0 } + ["المصدر: " + guide.source.absoluteString]
        return lines.joined(separator: "\n")
    }

    static func source(in reply: String) -> URL? {
        guard let last = reply.split(separator: "\n").last else { return nil }
        return ServiceGuide.library.first { String(last) == "المصدر: " + $0.source.absoluteString }?.source
    }
}

struct GuidesPanel: View {
    let onUse: (String) -> Void

    init(onUse: @escaping (String) -> Void = { _ in }) {
        self.onUse = onUse
    }
    @EnvironmentObject private var preferences: WorkspacePreferences
    @State private var search = ""
    @State private var favoritesOnly = false
    @State private var expandedID: String?

    private var favorites: Set<String> {
        Set(preferences.savedGuideIDs.split(separator: "|").map(String.init))
    }

    private var matching: [ServiceGuide] {
        let words = search.resourceSearchKey.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        return ServiceGuide.library.filter { guide in
            let text = ([guide.title, guide.provider, guide.keywords] + guide.checklist)
                .joined(separator: " ").resourceSearchKey
            return (!favoritesOnly || favorites.contains(guide.id)) && words.allSatisfy { text.contains($0) }
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("مركز المعرفة").font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
                HStack {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("ابحث بالخدمة أو المنصة", text: $search).textFieldStyle(.plain)
                    if !search.isEmpty {
                        Button { search = "" } label: { Image(systemName: "xmark.circle.fill") }
                            .buttonStyle(.plain).accessibilityLabel("مسح البحث")
                    }
                }
                .padding(12).background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
                Picker("الأدلة المعروضة", selection: $favoritesOnly) {
                    Text("كل الأدلة").tag(false)
                    Text("المفضلة").tag(true)
                }.pickerStyle(.segmented)
                if matching.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(search.isEmpty ? "لم تُضف أدلة إلى المفضلة" : "لم نعثر على دليل مطابق").font(.headline)
                        Text(search.isEmpty ? "اضغط رمز الإشارة المرجعية بجانب أي دليل لحفظه هنا." : "جرّب اسم المنصة أو كلمة واحدة من اسم الخدمة.")
                            .foregroundStyle(.secondary)
                    }.padding(.vertical)
                }
                ForEach(matching) { guide in
                    guideCard(guide)
                }
            }
            .padding(20).frame(maxWidth: 850, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
        }
    }

    private func guideCard(_ guide: ServiceGuide) -> some View {
        let isOpen = expandedID == guide.id
        let isFavorite = favorites.contains(guide.id)
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Button {
                    withAnimation(.easeInOut(duration: 0.16)) { expandedID = isOpen ? nil : guide.id }
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: guide.symbol)
                            .font(.title3.weight(.semibold)).foregroundStyle(Color.accentColor)
                            .frame(width: 40, height: 40)
                            .background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 11))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(guide.title).font(.headline)
                            Text(guide.provider).font(.subheadline).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 3)
                        Image(systemName: isOpen ? "chevron.up" : "chevron.down")
                            .font(.caption).foregroundStyle(.secondary)
                    }.contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityValue(isOpen ? "مفتوح" : "مطوي")
                Button {
                    var updated = favorites
                    if isFavorite { updated.remove(guide.id) } else { updated.insert(guide.id) }
                    preferences.savedGuideIDs = updated.sorted().joined(separator: "|")
                } label: {
                    Image(systemName: isFavorite ? "bookmark.fill" : "bookmark")
                        .foregroundStyle(isFavorite ? Color.accentColor : Color.secondary)
                        .frame(width: 38, height: 42)
                }.buttonStyle(.plain)
                    .accessibilityLabel(isFavorite ? "إزالة من المفضلة" : "إضافة إلى المفضلة")
                    .accessibilityHint(guide.title)
            }
            if isOpen {
                Divider()
                Text("قائمة التحضير").font(.subheadline.bold())
                ForEach(Array(guide.checklist.enumerated()), id: \.offset) { pair in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text((pair.offset + 1).formatted(.number.locale(Locale(identifier: "ar_SA"))))
                            .font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                        Text(pair.element).frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) { guideActions(guide) }
                    VStack(alignment: .leading, spacing: 10) { guideActions(guide) }
                }.padding(.top, 4)
            }
        }
        .padding(16)
        .background(.background, in: RoundedRectangle(cornerRadius: 15))
        .overlay(RoundedRectangle(cornerRadius: 15).stroke(.secondary.opacity(0.2), lineWidth: 1))
    }

    @ViewBuilder private func guideActions(_ guide: ServiceGuide) -> some View {
        Link(destination: guide.source) { Label("الدليل الرسمي", systemImage: "arrow.up.right.square") }
        Button {
            onUse(guide.assistantPrompt)
        } label: {
            Label("افتح القائمة في المساعد", systemImage: "bubble.left")
        }.buttonStyle(.bordered)
    }
}

private enum LetterKind: String, CaseIterable, Identifiable {
    case followUp = "متابعة معاملة"
    case documents = "طلب مستندات"
    case correction = "طلب تصحيح بيانات"
    case handover = "تسليم ملف"
    var id: Self { self }

    var detailsLabel: String {
        switch self {
        case .followUp: return "آخر إجراء أو استفسار"
        case .documents: return "المستندات المطلوبة"
        case .correction: return "البيان الحالي والتصحيح المطلوب"
        case .handover: return "محتويات الملف والخطوة التالية"
        }
    }

    var detailsExample: String {
        switch self {
        case .followUp: return "رفعنا المرفقات ونرغب بمعرفة حالة الطلب."
        case .documents: return "نسخة الرخصة ومرجع الطلب السابق."
        case .correction: return "اذكر البيان الحالي، ثم القيمة الصحيحة."
        case .handover: return "اذكر الملفات المسلّمة وما يحتاج إلى متابعة."
        }
    }

    func body(topic: String, reference: String, details: String) -> String {
        let item = reference.isEmpty ? topic : "\(topic) (المرجع \(reference))"
        switch self {
        case .followUp:
            return "نرجو إفادتنا بحالة \(item) والخطوة التالية المطلوبة.\n\(details)"
        case .documents:
            return "لاستكمال \(item)، نرجو تزويدنا بالمستندات التالية:\n\(details)"
        case .correction:
            return "نرجو مراجعة البيانات المتعلقة بموضوع \(item) وإفادتنا بنتيجة التصحيح المطلوب أدناه.\n\(details)"
        case .handover:
            return "نضع بين أيديكم ملف \(item). وفيما يلي محتوياته والخطوة التالية للمتابعة:\n\(details)\nنرجو تأكيد الاستلام."
        }
    }
}

struct TemplatesPanel: View {
    let onUse: (String) -> Void

    init(onUse: @escaping (String) -> Void = { _ in }) {
        self.onUse = onUse
    }
    @State private var kind: LetterKind = .followUp
    @State private var recipient = ""
    @State private var topic = ""
    @State private var reference = ""
    @State private var detailsByKind: [LetterKind: String] = [:]
    @State private var sender = ""
    @State private var copiedText: String?

    private var detail: Binding<String> {
        Binding(get: { detailsByKind[kind] ?? "" }, set: { detailsByKind[kind] = $0 })
    }

    private func trimmed(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var letter: String {
        let to = trimmed(recipient)
        let from = trimmed(sender)
        let subject = trimmed(topic)
        let details = trimmed(detailsByKind[kind] ?? "")
        guard !to.isEmpty && !subject.isEmpty && !details.isEmpty else { return "" }
        let body = kind.body(topic: subject, reference: trimmed(reference), details: details)
        let signature = from.isEmpty ? "" : "\n\(from)"
        return "إلى \(to)\nالموضوع: \(kind.rawValue) بشأن \(subject)\n\nالسلام عليكم ورحمة الله وبركاته،\n\n\(body)\n\nمع التحية والتقدير.\(signature)"
    }

    private var assistantPrompt: String { "مراجعة خطاب\n" + letter }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("قوالب المراسلات").font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
                VStack(alignment: .leading, spacing: 14) {
                    Picker("نوع الخطاب", selection: $kind) {
                        ForEach(LetterKind.allCases) { item in Text(item.rawValue).tag(item) }
                    }.pickerStyle(.menu)
                    Divider()
                    labeledField("الجهة المرسل إليها", placeholder: "اسم الجهة أو الإدارة", value: $recipient)
                    labeledField("الموضوع", placeholder: "مثال: تجديد رخصة الفرع", value: $topic)
                    labeledField("رقم المرجع (اختياري)", placeholder: "رقم الطلب أو المعاملة", value: $reference)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(kind.detailsLabel).font(.subheadline.bold())
                        TextField(kind.detailsExample, text: detail, axis: .vertical)
                            .lineLimit(3...8).textFieldStyle(.roundedBorder).accessibilityLabel(kind.detailsLabel)
                    }
                    labeledField("التوقيع (اختياري)", placeholder: "اسمك أو اسم القسم", value: $sender)
                }.padding(16)
                    .background(.background, in: RoundedRectangle(cornerRadius: 15))
                    .overlay(RoundedRectangle(cornerRadius: 15).stroke(.secondary.opacity(0.2), lineWidth: 1))
                VStack(alignment: .leading, spacing: 14) {
                    Label("نص الخطاب", systemImage: "doc.text").font(.headline)
                    if letter.isEmpty {
                        Text("أدخل الجهة والموضوع وتفاصيل الطلب لتظهر مسودة الخطاب هنا.")
                            .foregroundStyle(.secondary)
                    } else {
                        Text(verbatim: letter).frame(maxWidth: .infinity, alignment: .leading)
                            .lineSpacing(4).textSelection(.enabled)
                        Divider()
                        ViewThatFits(in: .horizontal) {
                            HStack(spacing: 10) { letterActions }
                            VStack(alignment: .leading, spacing: 10) { letterActions }
                        }
                        if assistantPrompt.count > 4000 {
                            Text("يمكنك فتح الخطاب كاملًا في المساعد، ثم اختصاره إلى ٤٠٠٠ حرف قبل الإرسال.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }.frame(maxWidth: .infinity, alignment: .leading).padding(16)
                    .background(Color.accentColor.opacity(0.065), in: RoundedRectangle(cornerRadius: 15))
            }
            .padding(20).frame(maxWidth: 850, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
        }
    }

    private func labeledField(_ title: String, placeholder: String, value: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title).font(.subheadline.bold())
            TextField(placeholder, text: value).textFieldStyle(.roundedBorder).accessibilityLabel(title)
        }
    }

    @ViewBuilder private var letterActions: some View {
        Button {
            #if os(macOS)
            NSPasteboard.general.clearContents()
            if NSPasteboard.general.setString(letter, forType: .string) { copiedText = letter }
            #elseif os(iOS)
            UIPasteboard.general.string = letter
            copiedText = letter
            #endif
        } label: {
            Label(copiedText == letter ? "تم نسخ الخطاب" : "نسخ الخطاب", systemImage: copiedText == letter ? "checkmark" : "doc.on.doc")
        }.buttonStyle(.borderedProminent)
        Button { onUse(assistantPrompt) } label: { Label("فتح في المساعد", systemImage: "bubble.left") }
            .buttonStyle(.bordered)
    }
}
