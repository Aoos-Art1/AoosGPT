import SwiftUI

@MainActor
struct CompanySignInView: View {
    @EnvironmentObject private var access: CompanyAccess

    var body: some View {
        let action: AccountFormAction = access.needsOwnerSetup ? .setUpOwner : .signIn
        AccountForm(action: action)
            .id(action)
            .environment(\.layoutDirection, .rightToLeft)
    }
}

@MainActor
struct CreateCompanyAccountView: View {
    @EnvironmentObject private var access: CompanyAccess
    @EnvironmentObject private var workspace: WorkspaceStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Group {
            if access.session?.isOwner == true {
                AccountForm(action: .createCompany, companies: workspace.companies, saveNewCompany: workspace.saveCompany)
            } else {
                VStack(spacing: 16) {
                    Text("إضافة حساب شركة متاحة للمالك فقط.")
                    Button("إغلاق") { dismiss() }
                }.padding()
            }
        }
        #if os(macOS)
        .frame(minWidth: 430, idealWidth: 490, minHeight: 420, idealHeight: 680)
        #endif
        .environment(\.layoutDirection, .rightToLeft)
    }
}

private enum AccountFormAction: Hashable {
    case signIn, setUpOwner, createCompany

    var title: String {
        switch self {
        case .signIn: return "تسجيل الدخول"
        case .setUpOwner: return "إعداد حساب المالك"
        case .createCompany: return "إضافة حساب شركة"
        }
    }

    var detail: String {
        switch self {
        case .signIn: return "أدخل معرّف الحساب وكلمة المرور لفتح مساحة عملك على هذا الجهاز."
        case .setUpOwner: return "سيطلب النظام التحقق من هوية مالك الجهاز. بعد الإعداد يمكنك إنشاء دخول مستقل لكل شركة."
        case .createCompany: return "اختر معرّفًا وكلمة مرور لتتمكّن الشركة من فتح مساحتها الخاصة على هذا الجهاز."
        }
    }

    var submitTitle: String {
        switch self {
        case .signIn: return "دخول مساحة العمل"
        case .setUpOwner: return "التحقق وإعداد الحساب"
        case .createCompany: return "إنشاء حساب الشركة"
        }
    }
}

@MainActor
private struct AccountForm: View {
    private enum Field: Hashable { case name, accountID, password, confirm }
    @EnvironmentObject private var access: CompanyAccess
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focus: Field?
    @State private var selectedCompanyID: UUID?
    @State private var name = ""
    @State private var accountID = ""
    @State private var password = ""
    @State private var confirm = ""
    @State private var error: String?
    @State private var submitting = false
    @State private var createdID: String?
    @State private var workspacePending = false

    let action: AccountFormAction
    let companies: [WorkspaceCompany]
    let saveNewCompany: (@MainActor (WorkspaceCompany) throws -> Void)?

    init(action: AccountFormAction, companies: [WorkspaceCompany] = [],
         saveNewCompany: (@MainActor (WorkspaceCompany) throws -> Void)? = nil) {
        self.action = action
        self.companies = companies
        self.saveNewCompany = saveNewCompany
    }

    private var trimmedID: String { accountID.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedName: String {
        if let selectedCompanyID {
            return companies.first { $0.id == selectedCompanyID }?.name ?? ""
        }
        return name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                if let createdID {
                    confirmation(createdID)
                } else {
                    HStack(spacing: 10) {
                        Image("BrandPortrait")
                            .resizable().scaledToFill()
                            .frame(width: 38, height: 38)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .accessibilityHidden(true)
                        Text(verbatim: "AoosGPT").font(.title3.bold())
                        Spacer(minLength: 0)
                        if action == .createCompany {
                            Button("إلغاء") { dismiss() }
                                .keyboardShortcut(.cancelAction).disabled(submitting)
                        }
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text(action.title).font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
                        Text(action.detail).foregroundStyle(.secondary)
                    }
                    fields
                    if let error {
                        Label(error, systemImage: "exclamationmark.circle")
                            .font(.callout).foregroundStyle(.red)
                            .accessibilityLabel("خطأ. " + error)
                    }
                    Button { submit() } label: {
                        HStack(spacing: 10) {
                            if submitting { ProgressView().controlSize(.small) }
                            Text(action.submitTitle).font(.headline)
                        }.frame(maxWidth: .infinity, minHeight: 36)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(submitting || trimmedID.isEmpty || password.isEmpty ||
                        (action != .signIn && (trimmedName.isEmpty || confirm.isEmpty)))
                }
            }
            .padding(24)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22))
            .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(Color.secondary.opacity(0.18)))
            .frame(maxWidth: 480)
            .padding(16)
            .frame(maxWidth: .infinity)
        }
        .background(Color("BrandAccent").opacity(0.05).ignoresSafeArea())
        .tint(Color("BrandAccent"))
        .interactiveDismissDisabled(submitting)
        .onDisappear { password = ""; confirm = "" }
    }

    private var fields: some View {
        VStack(alignment: .leading, spacing: 16) {
            if action == .createCompany && !companies.isEmpty {
                Picker("المنشأة", selection: $selectedCompanyID) {
                    Text("شركة جديدة").tag(Optional<UUID>.none)
                    ForEach(companies.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }) { company in
                        Text(company.registration.isEmpty ? company.name : company.name + " · " + company.registration)
                            .tag(Optional(company.id))
                    }
                }
                .pickerStyle(.menu)
            }
            if action != .signIn && selectedCompanyID == nil {
                let title = action == .setUpOwner ? "اسم المالك" : "اسم الشركة"
                accountField(title) {
                    TextField("", text: $name)
                        .accessibilityLabel(title)
                        .focused($focus, equals: .name)
                        .submitLabel(.next)
                        .onSubmit { focus = .accountID }
                }
            }
            accountField("معرّف الدخول") {
                TextField("", text: $accountID)
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
                    .autocorrectionDisabled()
                    .textContentType(.username)
                    .accessibilityLabel("معرّف الدخول")
                    .focused($focus, equals: .accountID)
                    .submitLabel(.next)
                    .onSubmit { focus = .password }
                if action != .signIn {
                    Text("من ٣ إلى ٦٤ حرفًا. يقبل الحروف والأرقام والنقطة والشرطة والشرطة السفلية.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            accountField("كلمة المرور") {
                if #available(macOS 14.0, *) {
                    SecureField("", text: $password)
                        .textContentType(action == .signIn ? .password : .newPassword)
                        .accessibilityLabel("كلمة المرور")
                        .focused($focus, equals: .password)
                        .submitLabel(action == .signIn ? .go : .next)
                        .onSubmit { if action == .signIn { submit() } else { focus = .confirm } }
                } else {
                    // Fallback on earlier versions
                }
                if action != .signIn {
                    Text("من ١٢ إلى ١٢٨ حرفًا.").font(.caption).foregroundStyle(.secondary)
                }
            }
            if action != .signIn {
                accountField("تأكيد كلمة المرور") {
                    SecureField("", text: $confirm)
                        .textContentType(.newPassword)
                        .accessibilityLabel("تأكيد كلمة المرور")
                        .focused($focus, equals: .confirm)
                        .submitLabel(.done).onSubmit { submit() }
                }
            }
        }
        .disabled(submitting)
    }

    private func accountField<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.subheadline.bold()).accessibilityHidden(true)
            content()
        }.textFieldStyle(.roundedBorder).controlSize(.large)
    }

    private func confirmation(_ id: String) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Image(systemName: "checkmark.circle.fill").font(.largeTitle)
                .foregroundStyle(Color("BrandAccent")).accessibilityHidden(true)
            Text("حساب الشركة جاهز").font(.title.bold()).accessibilityAddTraits(.isHeader)
            Text("تستطيع شركة «" + trimmedName + "» تسجيل الدخول على هذا الجهاز بالمعرّف التالي وكلمة المرور التي اخترتها.")
            Text(verbatim: id).font(.headline.monospaced()).textSelection(.enabled)
                .padding(10).background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
            if workspacePending {
                Text("أُنشئ الحساب. سيُستكمل إنشاء سجل الشركة عند أول دخول لها.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            Button("تم") { dismiss() }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
        }
    }

    private func submit() {
        guard !submitting, !trimmedID.isEmpty, !password.isEmpty else { return }
        error = nil
        if action != .signIn {
            guard !trimmedName.isEmpty else { focus = .name; return }
            guard (12...128).contains(password.count) else {
                error = "يجب أن تتكون كلمة المرور من ١٢ إلى ١٢٨ حرفًا."
                focus = .password
                return
            }
            guard confirm == password else {
                error = "كلمتا المرور غير متطابقتين."
                focus = .confirm
                return
            }
        }
        focus = nil
        submitting = true
        Task { @MainActor in
            defer { submitting = false }
            do {
                switch action {
                case .signIn:
                    try await access.login(accountID: trimmedID, password: password)
                case .setUpOwner:
                    try await access.setUpOwner(accountID: trimmedID, displayName: trimmedName, password: password)
                case .createCompany:
                    guard let owner = access.session, owner.isOwner, let saveNewCompany else {
                        self.error = "أعد تسجيل الدخول بحساب المالك ثم حاول مجددًا."
                        return
                    }
                    let isNew = selectedCompanyID == nil
                    let companyID = selectedCompanyID ?? UUID()
                    let companyName = trimmedName
                    try await access.addCompany(accountID: trimmedID, displayName: companyName,
                                                password: password, companyID: companyID)
                    createdID = trimmedID
                    if isNew {
                        if access.session?.id == owner.id && access.session?.isOwner == true {
                            do { try saveNewCompany(WorkspaceCompany(id: companyID, name: companyName)) }
                            catch { workspacePending = true }
                        } else {
                            workspacePending = true
                        }
                    }
                }
                password = ""
                confirm = ""
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
