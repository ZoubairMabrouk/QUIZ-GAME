import { randomUUID } from "node:crypto";
import { RuleError, requireRule } from "./rules.js";
export class TwilioVerify {
  constructor({ accountSid, authToken, serviceSid }, fetcher = fetch) {
    this.base = `https://verify.twilio.com/v2/Services/${serviceSid}`;
    this.authorization =
      "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    this.fetcher = fetcher;
    this.real = true;
  }
  async call(path, parameters) {
    let response;
    try {
      response = await this.fetcher(this.base + path, {
        method: "POST",
        headers: {
          authorization: this.authorization,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(parameters),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new RuleError("Verification provider unavailable", 503);
    }
    // Never propagate provider payloads: they can contain the number or account information.
    if (response.status === 429)
      throw new RuleError("Verification temporarily limited; try later", 429);
    if (response.status === 404) return null;
    if (!response.ok)
      throw new RuleError("Verification provider rejected the request", 502);
    try {
      return await response.json();
    } catch {
      throw new RuleError("Invalid provider response", 502);
    }
  }
  async send(phone, channel) {
    const r = await this.call("/Verifications", {
      To: phone,
      Channel: channel,
    });
    requireRule(
      r?.status === "pending" && /^VE[0-9a-fA-F]{32}$/.test(r.sid),
      "Verification could not be started",
      502,
    );
    return r.sid;
  }
  async check(sid, code) {
    const r = await this.call("/VerificationCheck", {
      VerificationSid: sid,
      Code: code,
    });
    return r?.status === "approved";
  }
}
export class MockVerify {
  constructor({ mode, phones }) {
    requireRule(mode !== "production", "Mock OTP forbidden in production");
    this.phones = new Set(phones);
    this.real = false;
  }
  async send(phone) {
    requireRule(this.phones.has(phone), "Number not allowed in mock mode");
    return "mock-" + randomUUID();
  }
  async check(sid, code) {
    return sid.startsWith("mock-") && code === "000000";
  }
}
