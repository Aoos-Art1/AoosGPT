import { expect, test, type Page } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const sections = ["dashboard", "assistant", "history", "letters", "calculators", "compliance", "hiring", "platforms", "company", "settings"];
const fixture = process.env.AOOS_TEST_FIXTURES ? JSON.parse(readFileSync(process.env.AOOS_TEST_FIXTURES, "utf8")) as { email: string; viewerEmail?: string; adminEmail: string; tenantId: string; password: string } : null;

async function captureScreenshot(page: Page, name: string, project: string) {
  const directory = path.resolve("docs/screenshots");
  mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, `${name}-${project}.png`);
  await page.evaluate(() => document.fonts.ready);
  if (project === "mobile") {
    await page.screenshot({ path: filename, fullPage: true });
    return;
  }

  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Desktop screenshots require an explicit viewport.");
  const height = await page.evaluate(() => Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)));
  try {
    // Chromium fullPage captures can omit fixed-sidebar descendants. Capture
    // an actual viewport tall enough for the page, then restore the test size.
    await page.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, height) });
    await page.screenshot({ path: filename, fullPage: false });
  } finally {
    await page.setViewportSize(viewport);
  }
}

async function login(page: Page, email = fixture?.email) {
  if (!fixture) throw new Error("Use npm run test:integration -- --browser for authenticated browser validation.");
  await page.goto("/login/company");
  await page.getByLabel("البريد الإلكتروني", { exact: true }).fill(email || fixture.email);
  await page.getByLabel("كلمة المرور", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "تسجيل الدخول", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  await expect(page.locator("main h1")).toContainText("حيّاك");
}

async function expectViewportFits(page: Page) {
  const widths = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, layout: window.innerWidth }));
  const expectedWidth = page.viewportSize()!.width;
  expect(widths.content, "Assistant content must remain inside the configured viewport").toBeLessThanOrEqual(expectedWidth + 1);
  expect(widths.layout, "Assistant controls must not enlarge the mobile layout viewport").toBeLessThanOrEqual(expectedWidth + 1);
}

test("all ten RTL destinations render without page errors or horizontal overflow", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`${message.text()} (${message.location().url || "unknown source"})`); });
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`);
  });
  for (const section of sections) {
    await page.goto(`/preview/${section}`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator(".demo-banner")).toContainText("البيانات افتراضية");
    if (section === "dashboard") {
      const icon = page.locator('link[rel="icon"]');
      await expect(icon).toHaveAttribute("href", "/icon.svg");
      const asset = await page.request.get((await icon.getAttribute("href"))!);
      expect(asset.ok()).toBe(true);
      expect(asset.headers()["content-type"]).toContain("image/svg+xml");
    }
    await page.evaluate(() => document.fonts.ready);
    const widths = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, layout: window.innerWidth }));
    const expectedWidth = page.viewportSize()!.width;
    expect(widths.content, `${section} content must fit the configured viewport`).toBeLessThanOrEqual(expectedWidth + 1);
    expect(widths.layout, `${section} must not enlarge the mobile layout viewport`).toBeLessThanOrEqual(expectedWidth + 1);
    if (["dashboard", "assistant"].includes(section)) {
      await captureScreenshot(page, section, info.project.name);
    }
  }
  expect(errors).toEqual([]);
});

test("navigation, search and focus work with keyboard and touch", async ({ page }, info) => {
  await page.goto("/preview/dashboard");
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: "فتح القائمة" }).click();
    await page.locator(".sidebar").getByRole("link", { name: /بيانات المنشأة/ }).click();
    await expect(page).toHaveURL(/\/preview\/company$/);
    await expect(page.locator("main h1")).toHaveText("بيانات المنشأة");
  } else {
    const sidebar = page.getByRole("complementary", { name: "القائمة الرئيسية" });
    await expect(sidebar).toBeVisible();
    const links = sidebar.locator(".sidebar-nav .nav-link");
    await expect(links).toHaveCount(sections.length);
    for (const link of await links.all()) await expect(link).toBeVisible();
    await sidebar.getByRole("link", { name: "بيانات المنشأة", exact: true }).click();
    await expect(page).toHaveURL(/\/preview\/company$/);
    await expect(page.locator("main h1")).toHaveText("بيانات المنشأة");
    const search = page.getByRole("dialog", { name: "البحث في أقسام AoosGPT" });
    // Confirm the client is interactive before exercising a global shortcut.
    await page.getByRole("button", { name: "البحث في الأقسام" }).click();
    await expect(search).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(search).toBeHidden();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(search).toBeVisible();
    await expect(search.getByRole("textbox")).toBeFocused();
    await search.getByRole("textbox").fill("الحاسبات");
    await search.getByRole("link", { name: /الحاسبات/ }).click();
    await expect(page).toHaveURL(/\/preview\/calculators$/);
    await page.getByRole("button", { name: "البحث في الأقسام" }).click();
    await page.keyboard.press("Escape");
    await expect(search).toBeHidden();
    await expect(page.getByRole("button", { name: "البحث في الأقسام" })).toBeFocused();
  }
});

test("calculators compute user inputs and the preview sends no business writes", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/") && request.method() !== "GET") writes.push(request.url()); });
  await page.goto("/preview/calculators");
  await page.getByLabel("المبلغ الأساسي (ريال)").fill("1000");
  await page.getByLabel("النسبة التي تريد حسابها (%)").fill("15");
  await expect(page.locator(".result-number strong")).toContainText("١٥٠");
  await page.goto("/preview/dashboard");
  await page.getByLabel("عنوان المهمة الجديدة").fill("مهمة معاينة مؤقتة");
  await page.getByRole("button", { name: "إضافة المهمة", exact: true }).click();
  await expect(page.getByText("مهمة معاينة مؤقتة", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("مهمة معاينة مؤقتة", { exact: true })).toBeHidden();
  expect(writes).toEqual([]);
});

test("skill examples preserve the draft, keep teaching mode and never auto-send in the RTL preview", async ({ page }) => {
  const chatRequests: string[] = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/chat") chatRequests.push(request.method()); });
  await page.goto("/preview/assistant");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const skill = page.getByLabel("مجال المساعدة", { exact: true });
  const mode = page.getByLabel("أسلوب المساعدة", { exact: true });
  const composer = page.getByRole("textbox", { name: "رسالتك إلى AoosGPT", exact: true });
  await expect(skill).toHaveValue("auto");
  await expect(mode).toHaveValue("answer");
  await mode.selectOption("learn");
  await composer.fill("أريد استخدام حالة افتراضية للتدرب.");
  await page.getByRole("button", { name: "استعراض المهارات", exact: true }).click();
  const library = page.getByRole("region", { name: "دليل مهارات AoosGPT", exact: true });
  await expect(library).toBeVisible();
  await expect(library.getByRole("article")).toHaveCount(9);
  await expect(page.getByRole("button", { name: "العودة إلى المحادثة", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expectViewportFits(page);
  await library.getByRole("button", { name: "استخدم مثال حل الحالات والتصعيد", exact: true }).click();
  await expect(skill).toHaveValue("aoos-case-resolution");
  await expect(mode).toHaveValue("learn");
  await expect(library).toBeHidden();
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue(/^أريد استخدام حالة افتراضية للتدرب\.\n\nلدي معاملة متعثرة/);
  expect(chatRequests).toEqual([]);
  await expectViewportFits(page);

  const longDraft = "س".repeat(7995);
  await composer.fill(longDraft);
  await page.getByRole("button", { name: "استعراض المهارات", exact: true }).click();
  await library.getByRole("button", { name: "استخدم مثال العمل والالتزام", exact: true }).click();
  await expect(composer).toHaveValue(longDraft);
  await expect(skill).toHaveValue("aoos-case-resolution");
  await expect(page.getByText("المسودة طويلة لإضافة المثال. اختصرها أو انسخ ما تحتاجه قبل المحاولة.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "العودة إلى المحادثة", exact: true }).click();
  await composer.fill("سؤال للمعاينة فقط");
  await page.getByRole("button", { name: "إرسال الرسالة", exact: true }).click();
  await expect(page.getByText("المعاينة لا تتصل بنموذج ذكاء اصطناعي. سجّل الدخول إلى مساحة عمل مهيأة لإرسال الرسائل.", { exact: true })).toBeVisible();
  expect(chatRequests).toEqual([]);
  await expect(page.locator(".message-assistant")).toHaveCount(0);
});

test("mocked chat sends the current skill and mode and safely renders structured replies", async ({ page }) => {
  test.skip(!fixture, "Disposable PostgreSQL fixture is supplied by the integration runner; model replies are mocked.");
  const requests: Record<string, unknown>[] = [];
  const mediaRequests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (request.url().includes("tracking.invalid")) mediaRequests.push(request.url()); });
  await page.route("https://tracking.invalid/**", (route) => route.abort());
  await page.route("**/api/capabilities", (route) => route.fulfill({ json: { chat: true, transcription: false, speech: false, speechLocale: null } }));
  let releaseReply = () => {};
  const pendingReply = new Promise<void>((resolve) => { releaseReply = resolve; });
  const markdown = [
    "## مثال تدريبي",
    "| الخطوة | الدليل | الملاحظة |\n| --- | --- | --- |\n| استكمال البيانات | مستند اصطناعي | يحتاج مراجعة |",
    "[مصدر للتجربة](https://example.gov.sa/guide)",
    "[رابط غير آمن](javascript:alert%281%29)",
    "![صورة خارجية](https://tracking.invalid/pixel)",
    '<script>window.__aoosUnsafeMarkdown = true</script>',
    '<img src="https://tracking.invalid/raw" onerror="window.__aoosUnsafeMarkdown = true">',
    "```text\n" + "code_".repeat(200) + "\n```",
  ].join("\n\n");
  await page.route("**/api/chat", async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    const replyIndex = requests.length;
    if (replyIndex === 1) await pendingReply;
    await route.fulfill({ json: { conversationId: "11111111-1111-4111-8111-111111111111", message: { id: `mocked-reply-${replyIndex}`, role: "assistant", content: replyIndex === 1 ? markdown : "إجابة اختبارية ثانية بعد تغيير الاختيار.", citations: [], createdAt: "2026-01-01T00:00:00.000Z" } } });
  });
  await login(page);
  await page.goto("/app/assistant");
  const skill = page.getByLabel("مجال المساعدة", { exact: true });
  const mode = page.getByLabel("أسلوب المساعدة", { exact: true });
  const composer = page.getByRole("textbox", { name: "رسالتك إلى AoosGPT", exact: true });
  await expect(page.getByText("الخدمة مهيأة", { exact: true })).toBeVisible();
  await skill.selectOption("aoos-labor-compliance");
  await mode.selectOption("learn");
  await composer.fill("اشرح لي طريقة مراجعة حالة افتراضية");
  try {
    await page.getByRole("button", { name: "إرسال الرسالة", exact: true }).click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toEqual({ message: "اشرح لي طريقة مراجعة حالة افتراضية", skill: "aoos-labor-compliance", mode: "learn" });
    await expect(skill).toBeDisabled();
    await expect(mode).toBeDisabled();
    await expect(composer).toBeDisabled();
  } finally {
    releaseReply();
  }
  const reply = page.locator(".assistant-markdown").first();
  await expect(reply.getByRole("heading", { name: "مثال تدريبي", level: 3 })).toBeVisible();
  await expect(reply.getByRole("table")).toHaveCount(1);
  await expect(reply.getByRole("region", { name: "جدول في إجابة AoosGPT" })).toHaveAttribute("tabindex", "0");
  const source = reply.getByRole("link", { name: "مصدر للتجربة", exact: true });
  await expect(source).toHaveAttribute("href", "https://example.gov.sa/guide");
  await expect(source).toHaveAttribute("rel", "noopener noreferrer");
  await expect(source).toHaveAttribute("target", "_blank");
  await expect(reply.getByRole("link", { name: "رابط غير آمن", exact: true })).toHaveCount(0);
  await expect(reply.locator("img,script,iframe")).toHaveCount(0);
  expect(await page.evaluate(() => Object.prototype.hasOwnProperty.call(window, "__aoosUnsafeMarkdown"))).toBe(false);
  expect(mediaRequests).toEqual([]);
  await expectViewportFits(page);

  await skill.selectOption("aoos-case-resolution");
  await mode.selectOption("answer");
  await composer.fill("أريد إجابة مباشرة الآن");
  await page.getByRole("button", { name: "إرسال الرسالة", exact: true }).click();
  await expect(page.getByText("إجابة اختبارية ثانية بعد تغيير الاختيار.", { exact: true })).toBeVisible();
  expect(requests[1]).toEqual({ message: "أريد إجابة مباشرة الآن", skill: "aoos-case-resolution", mode: "answer", conversationId: "11111111-1111-4111-8111-111111111111" });
  await expect(page.locator(".message-assistant")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("read-only viewers can browse skills without editing drafts or sending requests", async ({ page }) => {
  test.skip(!fixture?.viewerEmail, "Disposable read-only viewer fixture is supplied by the integration runner.");
  const chatRequests: string[] = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/chat") chatRequests.push(request.method()); });
  await page.route("**/api/capabilities", (route) => route.fulfill({ json: { chat: true, transcription: false, speech: false, speechLocale: null } }));
  await login(page, fixture!.viewerEmail);
  await page.goto("/app/assistant");
  await expect(page.getByLabel("مجال المساعدة", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("أسلوب المساعدة", { exact: true })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "رسالتك إلى AoosGPT", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "إرسال الرسالة", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "استعراض المهارات", exact: true }).click();
  const library = page.getByRole("region", { name: "دليل مهارات AoosGPT", exact: true });
  await expect(library).toBeVisible();
  const examples = library.getByRole("button", { name: /^استخدم مثال / });
  await expect(examples).toHaveCount(9);
  for (const button of await examples.all()) await expect(button).toBeDisabled();
  await expectViewportFits(page);
  await page.getByRole("button", { name: "العودة إلى المحادثة", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "رسالتك إلى AoosGPT", exact: true })).toHaveValue("");
  expect(chatRequests).toEqual([]);
});

test("admin can search an existing company, invite its member and revoke the link", async ({ page }, info) => {
  test.skip(!fixture, "Disposable admin fixture is supplied by the integration runner.");
  await page.goto("/login/admin");
  await page.getByLabel("البريد الإلكتروني", { exact: true }).fill(fixture!.adminEmail);
  await page.getByLabel("كلمة المرور", { exact: true }).fill(fixture!.password);
  await page.getByRole("button", { name: "تسجيل الدخول", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByLabel("البحث في مساحات العمل").fill("owner-a");
  await page.locator("form").filter({ has: page.getByLabel("البحث في مساحات العمل") }).getByRole("button", { name: "بحث", exact: true }).click();
  const company = page.getByRole("row").filter({ hasText: "مساحة اختبار owner-a" });
  await company.getByRole("button", { name: "دعوة عضو", exact: true }).click();
  const email = `browser-invite-${info.project.name}@validation.example`;
  await page.getByLabel("اسم المستخدم", { exact: true }).fill("عضو اختبار المتصفح");
  await page.getByLabel("البريد الإلكتروني", { exact: true }).fill(email);
  await expect(page.getByLabel("مساحة العمل", { exact: true })).toHaveValue(fixture!.tenantId);
  await page.getByRole("button", { name: "إنشاء رابط الدعوة", exact: true }).click();
  await expect(page.locator(".invite-link")).toContainText("/invite?token=");
  await page.getByLabel("البحث في الدعوات").fill(email);
  await page.locator("form").filter({ has: page.getByLabel("البحث في الدعوات") }).getByRole("button", { name: "بحث", exact: true }).click();
  const invitationRow = page.getByRole("row").filter({ hasText: email });
  await expect(invitationRow).toContainText("قيد الانتظار");
  page.on("dialog", (dialog) => dialog.accept());
  await invitationRow.getByRole("button", { name: "إلغاء الدعوة", exact: true }).click();
  await expect(invitationRow).toContainText("ملغاة");
});

test("private pages require authentication and login exposes password-manager fields", async ({ page }, info) => {
  await page.goto("/app/company");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByLabel("كلمة المرور", { exact: true })).toHaveAttribute("autocomplete", "current-password");
  await page.goto("/login/admin");
  await expect(page.getByRole("heading", { name: "دخول إدارة المنصة" })).toBeVisible();
  await captureScreenshot(page, "login", info.project.name);
});

test("authenticated company and letter changes persist, memory remains optional", async ({ page }, info) => {
  test.skip(!fixture, "Disposable PostgreSQL fixture is supplied by the integration runner.");
  await login(page);
  const employeeName = `موظف المتصفح ${info.project.name}`;
  await page.goto("/app/company");
  await page.getByRole("button", { name: "إضافة موظف", exact: true }).click();
  await page.getByLabel("اسم الموظف", { exact: true }).fill(employeeName);
  await page.getByLabel("المسمى الوظيفي", { exact: true }).fill("مسؤول اختبار");
  await page.getByLabel("الراتب الشهري (ريال)").fill("7500");
  await page.getByRole("button", { name: "حفظ الموظف", exact: true }).click();
  const employeeRow = page.getByRole("row").filter({ has: page.getByRole("button", { name: `حذف الموظف ${employeeName}`, exact: true }) });
  await expect(employeeRow).toContainText(employeeName);
  await page.reload();
  await expect(employeeRow).toContainText(employeeName);
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: `حذف الموظف ${employeeName}`, exact: true }).click();
  await expect(employeeRow).toBeHidden();
  await page.goto("/app/letters");
  await page.getByRole("button", { name: "خطاب جديد", exact: true }).click();
  const letterTitle = `خطاب المتصفح ${info.project.name}`;
  await page.getByLabel("عنوان الحفظ", { exact: true }).fill(letterTitle);
  await page.getByLabel("الجهة المرسل إليها", { exact: true }).fill("جهة اختبار");
  await page.getByLabel("الموضوع", { exact: true }).fill("تحقق الحفظ");
  await page.getByLabel("نص الخطاب", { exact: true }).fill("هذا خطاب اصطناعي لاختبار الحفظ والاسترجاع.");
  await page.getByRole("button", { name: "حفظ الخطاب", exact: true }).click();
  await expect(page.getByRole("heading", { name: letterTitle, exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: new RegExp(letterTitle) }).click();
  await expect(page.getByLabel("نص الخطاب", { exact: true })).toHaveValue("هذا خطاب اصطناعي لاختبار الحفظ والاسترجاع.");
  await page.goto("/app/settings");
  const memorySwitch = page.getByRole("switch", { name: "تفعيل ذاكرة التفضيلات" });
  await expect(memorySwitch).toHaveAttribute("aria-checked", "false");
  await memorySwitch.click();
  await expect(memorySwitch).toHaveAttribute("aria-checked", "true");
  await page.getByLabel("تفضيل جديد للذاكرة").fill(`تفضيل المتصفح ${info.project.name}`);
  await page.locator("form").filter({ has: page.getByLabel("تفضيل جديد للذاكرة") }).getByRole("button", { name: "إضافة", exact: true }).click();
  const memoryRow = page.locator(".item-row").filter({ hasText: `تفضيل المتصفح ${info.project.name}` });
  await expect(memoryRow).toBeVisible();
  await memoryRow.getByRole("button", { name: "حذف التفضيل المحفوظ" }).click();
  await expect(memoryRow).toBeHidden();
  await memorySwitch.click();
  await expect(memorySwitch).toHaveAttribute("aria-checked", "false");
  await page.goto("/app/assistant");
  await expect(page.getByText("غير مهيأ", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "إرسال الرسالة" })).toBeDisabled();
});
