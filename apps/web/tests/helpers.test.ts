import { describe, it, expect, afterEach, vi } from "vitest";
import { maskPhone } from "@/lib/logger";
import { pageParam } from "@/lib/format";
import { otpEchoEnabled } from "@/lib/otp";
import { supportContact } from "@/lib/support";

const ENV = { ...process.env };
afterEach(() => {
  vi.unstubAllEnvs();
  for (const k of Object.keys(process.env)) if (!(k in ENV)) delete process.env[k];
  Object.assign(process.env, ENV);
});

describe("maskPhone", () => {
  it("keeps only the first 4 and last 3 digits", () => {
    expect(maskPhone("966512345678")).toBe("9665****678");
    expect(maskPhone("+966 51 234 5678")).toBe("9665****678");
  });
  it("hides short or empty values completely", () => {
    expect(maskPhone("12345")).toBe("*****");
    expect(maskPhone("")).toBe("");
    expect(maskPhone(null)).toBe("");
  });
});

describe("pageParam", () => {
  it("parses a sane 1-based page", () => {
    expect(pageParam("3")).toBe(3);
    expect(pageParam(["7", "9"])).toBe(7);
  });
  it("falls back to 1 for junk and clamps huge values", () => {
    for (const v of ["abc", "-3", "0", "", undefined, null, "1e9"]) expect(pageParam(v)).toBe(1);
    expect(pageParam("999999999")).toBe(100000);
    expect(pageParam("50", 10)).toBe(10);
  });
});

describe("otpEchoEnabled", () => {
  it("echoes in development while no SMS provider is configured", () => {
    delete process.env.OTP_ECHO;
    delete process.env.UNIFONIC_APP_SID;
    delete process.env.SMS_PROVIDER;
    expect(otpEchoEnabled()).toBe(true);
    process.env.UNIFONIC_APP_SID = "sid";
    expect(otpEchoEnabled()).toBe(false);
    process.env.OTP_ECHO = "always";
    expect(otpEchoEnabled()).toBe(true);
    process.env.OTP_ECHO = "never";
    delete process.env.UNIFONIC_APP_SID;
    expect(otpEchoEnabled()).toBe(false);
  });
  it("never echoes in production unless both flags are set", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.UNIFONIC_APP_SID;
    delete process.env.ALLOW_OTP_ECHO_IN_PROD;
    process.env.OTP_ECHO = "auto";
    expect(otpEchoEnabled()).toBe(false);
    process.env.OTP_ECHO = "always";
    expect(otpEchoEnabled()).toBe(false);
    process.env.ALLOW_OTP_ECHO_IN_PROD = "1";
    expect(otpEchoEnabled()).toBe(true);
    process.env.OTP_ECHO = "auto";
    expect(otpEchoEnabled()).toBe(false);
  });
});

describe("supportContact", () => {
  it("normalizes the team phone and builds a WhatsApp link", () => {
    process.env.SUPPORT_PHONE = "0555555555";
    process.env.SUPPORT_EMAIL = " team@darak.sa ";
    expect(supportContact()).toEqual({ phone: "966555555555", phoneDisplay: "055 555 5555", whatsapp: "https://wa.me/966555555555", email: "team@darak.sa" });
  });
  it("returns nulls when nothing is configured", () => {
    process.env.SUPPORT_PHONE = "";
    process.env.SUPPORT_EMAIL = "";
    expect(supportContact()).toEqual({ phone: null, phoneDisplay: null, whatsapp: null, email: null });
  });
});

describe("smsProvider", () => {
  it("picks Authentica only when its key is present", async () => {
    const { smsProvider, smsProviderSupportsFreeText } = await import("@/lib/channels");
    process.env.SMS_PROVIDER = "authentica";
    delete process.env.AUTHENTICA_API_KEY;
    expect(smsProvider()).toBeNull();
    process.env.AUTHENTICA_API_KEY = "$2y$10$TESTKEYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    expect(smsProvider()).toBe("authentica");
    expect(smsProviderSupportsFreeText()).toBe(false);
    process.env.SMS_PROVIDER = "unifonic";
    delete process.env.UNIFONIC_APP_SID;
    expect(smsProvider()).toBeNull();
    process.env.UNIFONIC_APP_SID = "sid";
    expect(smsProvider()).toBe("unifonic");
    expect(smsProviderSupportsFreeText()).toBe(true);
  });
});

describe("Authentica send-otp adapter", () => {
  it("posts our own code in E.164 form and reads the success flag", async () => {
    const { sendMessage } = await import("@/lib/channels");
    process.env.SMS_PROVIDER = "authentica";
    process.env.AUTHENTICA_API_KEY = "$2y$10$TESTKEYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    process.env.AUTHENTICA_TEMPLATE_ID = "31";
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ success: true, data: null, message: "OTP send successfully" }), { status: 200 });
    });
    const r = await sendMessage({ channel: "SMS", to: "0501339148", body: "رمز الدخول إلى دارك: 123456", otp: "123456", entityType: "OTP" });
    expect(r).toMatchObject({ ok: true, provider: "authentica", simulated: false });
    expect(calls[0].url).toBe("https://api.authentica.sa/api/v2/send-otp");
    expect((calls[0].init.headers as Record<string, string>)["X-Authorization"]).toBe("$2y$10$TESTKEYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ method: "sms", phone: "+966501339148", otp: "123456", template_id: 31 });
    vi.unstubAllGlobals();
  });
  it("reports vendor errors and never sends free-text messages", async () => {
    const { sendMessage } = await import("@/lib/channels");
    process.env.SMS_PROVIDER = "authentica";
    process.env.AUTHENTICA_API_KEY = "$2y$10$TESTKEYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ errors: [{ message: "Unauthorized" }] }), { status: 401 }));
    const bad = await sendMessage({ channel: "SMS", to: "0501339148", body: "x", otp: "123456", entityType: "OTP" });
    expect(bad).toMatchObject({ ok: false, provider: "authentica", simulated: false, error: "Unauthorized" });
    const reminder = await sendMessage({ channel: "SMS", to: "0501339148", body: "تذكير بالدفعة المستحقة" });
    expect(reminder).toMatchObject({ ok: true, provider: "authentica", simulated: true });
    vi.unstubAllGlobals();
  });
});

describe("authenticaKey", () => {
  it("prefers the base64 form and survives a .env expander pass", async () => {
    const { authenticaKey, smsProvider } = await import("@/lib/channels");
    const raw = "$2y$10$TESTKEYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    process.env.SMS_PROVIDER = "authentica";
    process.env.AUTHENTICA_API_KEY = "/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"; // what dotenv-expand leaves of the raw key
    process.env.AUTHENTICA_API_KEY_B64 = Buffer.from(raw).toString("base64");
    expect(authenticaKey()).toBe(raw);
    expect(smsProvider()).toBe("authentica");
    delete process.env.AUTHENTICA_API_KEY_B64;
    expect(authenticaKey()).toBe("/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
    delete process.env.AUTHENTICA_API_KEY;
    expect(authenticaKey()).toBeNull();
    expect(smsProvider()).toBeNull();
  });
});

describe("loginAllowedPhones", () => {
  it("normalizes the allowlist and gates numbers only while set", async () => {
    const { loginAllowedPhones, loginAllowed } = await import("@/lib/auth");
    process.env.LOGIN_ALLOWED_PHONES = "0501339148, +966500159105 ,garbage";
    expect(loginAllowedPhones()).toEqual(["966501339148", "966500159105"]);
    expect(loginAllowed("966501339148")).toBe(true);
    expect(loginAllowed("966512345678")).toBe(false);
    process.env.LOGIN_ALLOWED_PHONES = "";
    expect(loginAllowedPhones()).toBeNull();
    expect(loginAllowed("966512345678")).toBe(true);
  });
  it("lets the fake test numbers through a closed-test allowlist unless TEST_ACCOUNTS=off", async () => {
    const { loginAllowed } = await import("@/lib/auth");
    process.env.LOGIN_ALLOWED_PHONES = "0501339148";
    expect(loginAllowed("966500000001")).toBe(true);
    process.env.TEST_ACCOUNTS = "off";
    expect(loginAllowed("966500000001")).toBe(false);
    delete process.env.TEST_ACCOUNTS;
    process.env.LOGIN_ALLOWED_PHONES = "";
  });
});

describe("test accounts", () => {
  it("one fake number per role, never the platform admin, switchable", async () => {
    const { TEST_ACCOUNTS, isTestPhone } = await import("@/lib/test-accounts");
    expect(new Set(TEST_ACCOUNTS.map((a) => a.phone)).size).toBe(TEST_ACCOUNTS.length);
    expect(isTestPhone("966500000000")).toBe(false); // demo platform admin is not a test account
    expect(isTestPhone("966501339148")).toBe(false);
    expect(isTestPhone("966500000005")).toBe(true);
    process.env.TEST_ACCOUNTS = "off";
    expect(isTestPhone("966500000005")).toBe(false);
    delete process.env.TEST_ACCOUNTS;
  });
});
