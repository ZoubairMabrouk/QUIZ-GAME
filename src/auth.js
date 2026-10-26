import { randomUUID } from "node:crypto";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { requireRule } from "./rules.js";
export class Auth {
  constructor({ store, security, provider, config }) {
    Object.assign(this, { store, security, provider, config });
  }
  normalizePhone(value) {
    requireRule(
      typeof value === "string" && /^\+[1-9][0-9]{7,14}$/.test(value),
      "Use an international number such as +33612345678",
    );
    const parsed = parsePhoneNumberFromString(value);
    requireRule(parsed?.isValid(), "Invalid phone number");
    requireRule(
      this.config.countries.includes(parsed.country) ||
        (!this.provider.real && this.config.mockPhones.includes(value)),
      "Country not enabled",
    );
    return parsed.number;
  }
  async request({ phone, channel = "sms", consent }, ip) {
    requireRule(
      consent === true,
      "Consent is required to send a verification code",
    );
    const number = this.normalizePhone(phone);
    requireRule(this.config.channels.includes(channel), "Channel not enabled");
    // Quotas apply across both channels. Values in Redis keys are keyed hashes, not raw phone/IP.
    await this.security.limit("otp-request-ip", ip, 20, 3600);
    await this.security.limit("otp-request-phone", number, 5, 3600);
    await this.security.limit(
      "otp-global",
      "all",
      this.config.sendDailyLimit,
      86400,
    );
    return this.security.locked(number, async (lock) => {
      await this.security.cooldown(number);
      const sid = await this.provider.send(number, channel);
      const id = randomUUID();
      await this.security.saveChallenge(
        { id, phone: number, sid, channel, real: this.provider.real },
        lock,
      );
      return { challengeId: id, expiresIn: 300, resendAfter: 60, channel };
    });
  }
  async verify({ challengeId, code }, ip) {
    requireRule(
      typeof challengeId === "string" && /^[0-9a-f-]{36}$/.test(challengeId),
      "Invalid challenge",
    );
    requireRule(
      typeof code === "string" && /^[0-9]{4,10}$/.test(code),
      "Invalid code format",
    );
    await this.security.limit("otp-check-ip", ip, 50, 600);
    const challenge = await this.security.challenge(challengeId);
    requireRule(challenge, "Invalid or expired code", 401);
    // A mock challenge can never become a verified identity following a mode switch.
    requireRule(
      challenge.real === this.provider.real,
      "Request a new code",
      401,
    );
    return this.security.locked(challenge.phone, async (lock) => {
      requireRule(
        await this.security.isActive(challenge),
        "Invalid or expired code",
        401,
      );
      await this.security.limit("otp-check-challenge", challengeId, 5, 300);
      await this.security.limit("otp-check-phone", challenge.phone, 15, 3600);
      requireRule(
        await this.provider.check(challenge.sid, code),
        "Invalid or expired code",
        401,
      );
      requireRule(
        await this.security.consume(challenge, lock),
        "Code already used or expired",
        401,
      );
      // Consume before database write: on DB failure the user requests another code (fail closed).
      return this.store.completeLogin({
        challengeId,
        phone: challenge.phone,
        verified: this.provider.real,
      });
    });
  }
}
