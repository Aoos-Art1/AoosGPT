import { expect, test, type Page } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const sections = ["dashboard", "assistant", "history", "letters", "calculators", "compliance", "hiring", "platforms", "company", "settings"];
const fixture = process.env.AOOS_TEST_FIXTURES ? JSON.parse(readFileSync(process.env.AOOS_TEST_FIXTURES, "utf8")) as { email: string; adminEmail: string; tenantId: string; password: string } : null;

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

async function login(page: Page) {
  if (!fixture) throw new Error("Use npm run test:integration -- --browser for authenticated browser validation.");
  await page.goto("/login/company");
  await page.getByLabel("البريد الإلكتروني", { exact: true }).fill(fixture.email);
  await page.getByLabel("كلمة المرور", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "تسجيل الدخول", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  await expect(page.locator("main h1")).toContainText("حيّاك");
}

test("all ten RTL destinations render without page errors or horizontal overflow", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  for (const section of sections) {
    await page.goto(`/preview/${section}`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator(".demo-banner")).toContainText("البيانات افتراضية");
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
    const search = page.getByRole("dialog", { name: "البحث في أقسام سعود" });
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
