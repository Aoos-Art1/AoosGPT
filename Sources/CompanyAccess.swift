import Combine
import CommonCrypto
import Foundation
import LocalAuthentication
import Security

struct CompanySession: Identifiable, Equatable, Sendable {
    let id: UUID
    let accountID: String
    let displayName: String
    let isOwner: Bool
}

private enum CompanyAccessError: LocalizedError {
    case unavailable, busy, cancelled, deviceVerification, alreadySetUp
    case invalidLogin, ownerRequired, duplicateAccount, duplicateWorkspace
    case invalidAccountID, invalidDisplayName, invalidPassword

    var errorDescription: String? {
        switch self {
        case .unavailable: return "تعذّر الوصول إلى حسابات هذا الجهاز. افتح قفل الجهاز وأعد المحاولة."
        case .busy: return "توجد عملية حساب جارية. انتظر انتهاءها ثم أعد المحاولة."
        case .cancelled: return "أُلغيت العملية."
        case .deviceVerification: return "تعذّر التحقق من مالك الجهاز. أكمل التحقق بقفل الجهاز ثم أعد المحاولة."
        case .alreadySetUp: return "سبق إعداد حساب المالك على هذا الجهاز."
        case .invalidLogin: return "معرّف الدخول أو كلمة المرور غير صحيحة."
        case .ownerRequired: return "يتطلب إنشاء حساب شركة تسجيل الدخول بحساب المالك."
        case .duplicateAccount: return "معرّف الدخول مستخدم. اختر معرّفًا آخر."
        case .duplicateWorkspace: return "ترتبط مساحة الشركة هذه بحساب آخر."
        case .invalidAccountID: return "استخدم معرّفًا من ٣ إلى ٦٤ حرفًا من الحروف والأرقام والنقطة والشرطة والشرطة السفلية."
        case .invalidDisplayName: return "أدخل اسمًا من حرف واحد إلى ١٠٠ حرف."
        case .invalidPassword: return "أدخل كلمة مرور من ١٢ إلى ١٢٨ حرفًا."
        }
    }
}

private struct LocalCompanyAccount: Codable, Sendable {
    let id: UUID
    let accountID: String
    let displayName: String
    let salt: Data
    let verifier: Data

    func session(isOwner: Bool) -> CompanySession {
        CompanySession(id: id, accountID: accountID, displayName: displayName, isOwner: isOwner)
    }
}

private struct CompanyDirectory: Codable {
    let formatVersion: Int
    var revision: UUID
    let owner: LocalCompanyAccount
    var companies: [LocalCompanyAccount]

    var accounts: [LocalCompanyAccount] { [owner] + companies }

    func validate() throws {
        let records = accounts
        guard formatVersion == 1,
              Set(records.map(\.id)).count == records.count,
              Set(records.map(\.accountID)).count == records.count,
              records.allSatisfy({ record in
                  record.salt.count == CompanyCredentials.saltSize &&
                  record.verifier.count == CompanyCredentials.verifierSize &&
                  CompanyCredentials.normalizedID(record.accountID) == record.accountID &&
                  CompanyCredentials.validID(record.accountID) &&
                  CompanyCredentials.validName(record.displayName)
              }) else { throw CompanyAccessError.unavailable }
    }
}

private enum CompanyCredentials {
    static let saltSize = 16
    static let verifierSize = 32
    // Version 1 of the directory uses PBKDF2-HMAC-SHA256 with these parameters.
    static let iterations: UInt32 = 600_000
    static let idCharacters = CharacterSet.letters.union(.decimalDigits)
        .union(CharacterSet(charactersIn: "._-"))

    static func normalizedID(_ raw: String) -> String {
        raw.trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased(with: Locale(identifier: "en_US_POSIX")).precomposedStringWithCanonicalMapping
    }

    static func validID(_ value: String) -> Bool {
        (3...64).contains(value.count) && value.unicodeScalars.allSatisfy(idCharacters.contains)
    }

    static func validName(_ value: String) -> Bool {
        (1...100).contains(value.count) && !value.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
    }

    static func passwordFits(_ value: String) -> Bool {
        (12...128).contains(value.count) && value.utf8.count <= 4096 &&
            !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    static func randomSalt() throws -> Data {
        var bytes = [UInt8](repeating: 0, count: saltSize)
        let status = bytes.withUnsafeMutableBytes { buffer in
            SecRandomCopyBytes(kSecRandomDefault, buffer.count, buffer.baseAddress!)
        }
        guard status == errSecSuccess else { throw CompanyAccessError.unavailable }
        return Data(bytes)
    }

    static func derive(password: String, salt: Data) async throws -> Data {
        try await Task.detached(priority: .userInitiated) {
            let input = password.utf8CString
            var digest = [UInt8](repeating: 0, count: verifierSize)
            let status = input.withUnsafeBufferPointer { passwordBuffer in
                salt.withUnsafeBytes { saltBuffer in
                    digest.withUnsafeMutableBufferPointer { output in
                        CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2),
                            passwordBuffer.baseAddress, passwordBuffer.count - 1,
                            saltBuffer.bindMemory(to: UInt8.self).baseAddress, saltBuffer.count,
                            CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), iterations,
                            output.baseAddress, output.count)
                    }
                }
            }
            guard status == kCCSuccess else { throw CompanyAccessError.unavailable }
            return Data(digest)
        }.value
    }

    static func matches(_ lhs: Data, _ rhs: Data) -> Bool {
        guard lhs.count == verifierSize, rhs.count == verifierSize else { return false }
        var difference: UInt8 = 0
        for (left, right) in zip(lhs, rhs) { difference |= left ^ right }
        return difference == 0
    }
}

private enum CompanyKeychain {
    // The defaults marker contains no credentials. Losing a previously created
    // device-only Keychain item must never turn the account screen into an owner claim.
    private static let provisionedKey = "aoosgpt.company-access.provisioned.v1"

    private static var query: [String: Any] {
        var result: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: (Bundle.main.bundleIdentifier ?? "AoosGPT") + ".company-access",
            kSecAttrAccount as String: "directory-v1",
            kSecAttrSynchronizable as String: false
        ]
        #if os(macOS)
        result[kSecUseDataProtectionKeychain as String] = true
        #endif
        return result
    }

    static func read() throws -> CompanyDirectory? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &item)
        if status == errSecItemNotFound && !UserDefaults.standard.bool(forKey: provisionedKey) {
            return nil
        }
        guard status == errSecSuccess, let data = item as? Data,
              let directory = try? PropertyListDecoder().decode(CompanyDirectory.self, from: data)
        else { throw CompanyAccessError.unavailable }
        try directory.validate()
        UserDefaults.standard.set(true, forKey: provisionedKey)
        return directory
    }

    static func write(_ directory: CompanyDirectory, replacing previous: UUID? = nil) throws {
        try directory.validate()
        var attributes: [String: Any] = [
            kSecValueData as String: try PropertyListEncoder().encode(directory),
            kSecAttrGeneric as String: Data(directory.revision.uuidString.utf8)
        ]
        var request = query
        let status: OSStatus
        if let previous {
            // Match the revision read by the writer so another app instance's
            // successful insert cannot be lost during a read-modify-write.
            request[kSecAttrGeneric as String] = Data(previous.uuidString.utf8)
            status = SecItemUpdate(request as CFDictionary, attributes as CFDictionary)
            if status == errSecItemNotFound { throw CompanyAccessError.busy }
        } else {
            attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            request.merge(attributes) { _, new in new }
            status = SecItemAdd(request as CFDictionary, nil)
            if status == errSecDuplicateItem { throw CompanyAccessError.alreadySetUp }
        }
        guard status == errSecSuccess else { throw CompanyAccessError.unavailable }
        UserDefaults.standard.set(true, forKey: provisionedKey)
    }
}

@MainActor
final class CompanyAccess: ObservableObject {
    @Published private(set) var session: CompanySession?
    @Published private(set) var needsOwnerSetup = false
    private var operation: UUID?

    init() { refreshSetupState() }

    func refreshSetupState() {
        _ = try? currentDirectory()
    }

    func setUpOwner(accountID: String, displayName: String, password: String) async throws {
        guard session == nil else { throw CompanyAccessError.alreadySetUp }
        let token = try begin()
        defer { finish(token) }
        let fields = try validatedFields(accountID, displayName, password)
        guard try currentDirectory() == nil else { throw CompanyAccessError.alreadySetUp }
        let context = LAContext()
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) else {
            throw CompanyAccessError.deviceVerification
        }
        let authorized = try? await context.evaluatePolicy(.deviceOwnerAuthentication,
            localizedReason: "تحقّق من هويتك لتفعيل حساب المالك والوصول إلى مساحة العمل السابقة على هذا الجهاز.")
        guard authorized == true else { throw CompanyAccessError.deviceVerification }
        try ensureCurrent(token)
        let owner = try await makeAccount(id: UUID(), fields: fields, password: password)
        try ensureCurrent(token)
        guard try currentDirectory() == nil else { throw CompanyAccessError.alreadySetUp }
        try CompanyKeychain.write(CompanyDirectory(formatVersion: 1, revision: UUID(),
            owner: owner, companies: []))
        needsOwnerSetup = false
        session = owner.session(isOwner: true)
    }

    func login(accountID: String, password: String) async throws {
        let token = try begin()
        defer { finish(token) }
        guard session == nil else { throw CompanyAccessError.busy }
        guard let directory = try currentDirectory() else { throw CompanyAccessError.invalidLogin }
        let id = CompanyCredentials.normalizedID(accountID)
        guard CompanyCredentials.validID(id), CompanyCredentials.passwordFits(password) else {
            throw CompanyAccessError.invalidLogin
        }
        let account = directory.accounts.first { $0.accountID == id }
        // Unknown but well-formed IDs incur the same derivation work as a wrong password.
        let salt = account?.salt ?? directory.owner.salt
        let digest = try await CompanyCredentials.derive(password: password, salt: salt)
        try ensureCurrent(token)
        let verified = CompanyCredentials.matches(digest, account?.verifier ?? directory.owner.verifier)
        guard verified, let account else { throw CompanyAccessError.invalidLogin }
        session = account.session(isOwner: account.id == directory.owner.id)
    }

    func addCompany(accountID: String, displayName: String, password: String,
                    companyID: UUID? = nil) async throws {
        guard let owner = session, owner.isOwner else { throw CompanyAccessError.ownerRequired }
        let token = try begin()
        defer { finish(token) }
        let fields = try validatedFields(accountID, displayName, password)
        let account = try await makeAccount(id: companyID ?? UUID(), fields: fields, password: password)
        try ensureCurrent(token)
        guard session == owner, var directory = try currentDirectory(), directory.owner.id == owner.id
        else { throw CompanyAccessError.ownerRequired }
        guard !directory.accounts.contains(where: { $0.accountID == account.accountID }) else {
            throw CompanyAccessError.duplicateAccount
        }
        guard !directory.accounts.contains(where: { $0.id == account.id }) else {
            throw CompanyAccessError.duplicateWorkspace
        }
        let previous = directory.revision
        directory.companies.append(account)
        directory.revision = UUID()
        try CompanyKeychain.write(directory, replacing: previous)
    }

    func logout() {
        operation = nil
        session = nil
    }

    private func currentDirectory() throws -> CompanyDirectory? {
        do {
            let directory = try CompanyKeychain.read()
            needsOwnerSetup = directory == nil
            return directory
        } catch {
            needsOwnerSetup = false
            throw error
        }
    }

    private func validatedFields(_ accountID: String, _ displayName: String, _ password: String)
        throws -> (id: String, name: String) {
        let id = CompanyCredentials.normalizedID(accountID)
        let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard CompanyCredentials.validID(id) else { throw CompanyAccessError.invalidAccountID }
        guard CompanyCredentials.validName(name) else { throw CompanyAccessError.invalidDisplayName }
        guard CompanyCredentials.passwordFits(password) else { throw CompanyAccessError.invalidPassword }
        return (id, name)
    }

    private func makeAccount(id: UUID, fields: (id: String, name: String), password: String)
        async throws -> LocalCompanyAccount {
        let salt = try CompanyCredentials.randomSalt()
        let verifier = try await CompanyCredentials.derive(password: password, salt: salt)
        return LocalCompanyAccount(id: id, accountID: fields.id, displayName: fields.name,
                                   salt: salt, verifier: verifier)
    }

    private func begin() throws -> UUID {
        guard operation == nil else { throw CompanyAccessError.busy }
        let token = UUID()
        operation = token
        return token
    }

    private func ensureCurrent(_ token: UUID) throws {
        guard operation == token, !Task.isCancelled else { throw CompanyAccessError.cancelled }
    }

    private func finish(_ token: UUID) {
        if operation == token { operation = nil }
    }
}
