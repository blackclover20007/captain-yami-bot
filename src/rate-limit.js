export class DownloadRateLimiter {
  constructor({ cooldownMs = 60000, maxConcurrentPerUser = 1 } = {}) {
    this.cooldownMs = cooldownMs;
    this.maxConcurrentPerUser = maxConcurrentPerUser;
    this.users = new Map();
  }

  tryAcquire(userId) {
    const now = Date.now();
    const state = this.users.get(userId) || {
      lastStartedAt: 0,
      active: 0
    };

    if (state.active >= this.maxConcurrentPerUser) {
      return {
        allowed: false,
        reason: 'active',
        retryAfterMs: 0
      };
    }

    const elapsed = now - state.lastStartedAt;
    if (elapsed < this.cooldownMs) {
      return {
        allowed: false,
        reason: 'cooldown',
        retryAfterMs: this.cooldownMs - elapsed
      };
    }

    state.lastStartedAt = now;
    state.active += 1;
    this.users.set(userId, state);

    return { allowed: true };
  }

  release(userId) {
    const state = this.users.get(userId);
    if (!state) return;

    state.active = Math.max(0, state.active - 1);

    if (state.active === 0 && Date.now() - state.lastStartedAt > this.cooldownMs * 2) {
      this.users.delete(userId);
    }
  }
}

export class RoleRateLimiter {
  constructor({ cooldownMs = 5000, maxPerMinute = 5 } = {}) {
    this.cooldownMs = cooldownMs;
    this.maxPerMinute = maxPerMinute;
    this.actions = new Map();
  }

  tryAcquire(userId) {
    const now = Date.now();
    const state = this.actions.get(userId) || {
      lastActionAt: 0,
      timestamps: []
    };

    state.timestamps = state.timestamps.filter((timestamp) => now - timestamp < 60000);

    const cooldownRemaining = this.cooldownMs - (now - state.lastActionAt);
    if (cooldownRemaining > 0) {
      return {
        allowed: false,
        reason: 'cooldown',
        retryAfterMs: cooldownRemaining
      };
    }

    if (state.timestamps.length >= this.maxPerMinute) {
      return {
        allowed: false,
        reason: 'window',
        retryAfterMs: 60000 - (now - state.timestamps[0])
      };
    }

    state.lastActionAt = now;
    state.timestamps.push(now);
    this.actions.set(userId, state);
    return { allowed: true };
  }
}
