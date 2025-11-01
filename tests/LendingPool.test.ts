import { describe, it, expect, beforeEach } from "vitest";
import { stringAsciiCV, uintCV } from "@stacks/transactions";

const ERR_INVALID_AMOUNT = 200;
const ERR_INSUFFICIENT_BALANCE = 201;
const ERR_NOT_ADMIN = 202;
const ERR_POOL_PAUSED = 203;
const ERR_INVALID_DURATION = 204;
const ERR_WITHDRAWAL_LOCKED = 205;
const ERR_ZERO_CONTRIBUTION = 206;
const ERR_MAX_CONTRIB_EXCEEDED = 207;
const ERR_INVALID_INTEREST_RATE = 208;
const ERR_UNLOCK_PERIOD_NOT_ENDED = 209;

interface Contribution {
  amount: bigint;
  lastContrib: bigint;
  lockedUntil: bigint;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class LendingPoolMock {
  state: {
    admin: string;
    poolPaused: boolean;
    totalPoolBalance: bigint;
    minContribution: bigint;
    maxContribution: bigint;
    withdrawalLockPeriod: bigint;
    baseInterestRate: bigint;
    unlockTimestamp: bigint;
    contributions: Map<string, Contribution>;
    historicalYields: Map<string, bigint>;
  } = {
    admin: "ST1TEST",
    poolPaused: false,
    totalPoolBalance: 0n,
    minContribution: 1000n,
    maxContribution: 100000n,
    withdrawalLockPeriod: 144n,
    baseInterestRate: 2n,
    unlockTimestamp: 0n,
    contributions: new Map(),
    historicalYields: new Map(),
  };
  blockHeight: bigint = 0n;
  caller: string = "ST1TEST";

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      admin: "ST1TEST",
      poolPaused: false,
      totalPoolBalance: 0n,
      minContribution: 1000n,
      maxContribution: 100000n,
      withdrawalLockPeriod: 144n,
      baseInterestRate: 2n,
      unlockTimestamp: 0n,
      contributions: new Map(),
      historicalYields: new Map(),
    };
    this.blockHeight = 0n;
    this.caller = "ST1TEST";
  }

  getAdmin(): Result<string> {
    return { ok: true, value: this.state.admin };
  }

  isPaused(): Result<boolean> {
    return { ok: true, value: this.state.poolPaused };
  }

  getTotalPoolBalance(): Result<bigint> {
    return { ok: true, value: this.state.totalPoolBalance };
  }

  getMinContribution(): Result<bigint> {
    return { ok: true, value: this.state.minContribution };
  }

  getMaxContribution(): Result<bigint> {
    return { ok: true, value: this.state.maxContribution };
  }

  getBaseInterestRate(): Result<bigint> {
    return { ok: true, value: this.state.baseInterestRate };
  }

  getUserContribution(user: string): Result<bigint> {
    const contrib = this.state.contributions.get(user);
    return { ok: true, value: contrib ? contrib.amount : 0n };
  }

  getUserLockedUntil(user: string): Result<bigint> {
    const contrib = this.state.contributions.get(user);
    return { ok: true, value: contrib ? contrib.lockedUntil : 0n };
  }

  isWithdrawalLocked(user: string): Result<boolean> {
    const contrib = this.state.contributions.get(user);
    const lockedUntil = contrib ? contrib.lockedUntil : 0n;
    return { ok: true, value: this.state.unlockTimestamp >= lockedUntil };
  }

  setAdmin(newAdmin: string): Result<boolean> {
    if (this.caller !== this.state.admin) {
      return { ok: false, value: ERR_NOT_ADMIN };
    }
    this.state.admin = newAdmin;
    return { ok: true, value: true };
  }

  pausePool(): Result<boolean> {
    if (this.caller !== this.state.admin) {
      return { ok: false, value: ERR_NOT_ADMIN };
    }
    this.state.poolPaused = true;
    return { ok: true, value: true };
  }

  unpausePool(): Result<boolean> {
    if (this.caller !== this.state.admin) {
      return { ok: false, value: ERR_NOT_ADMIN };
    }
    this.state.poolPaused = false;
    return { ok: true, value: true };
  }

  setMinContribution(newMin: bigint): Result<boolean> {
    if (this.caller !== this.state.admin) {
      return { ok: false, value: ERR_NOT_ADMIN };
    }
    if (newMin <= 0n) {
      return { ok: false, value: ERR_INVALID_AMOUNT };
    }
    this.state.minContribution = newMin;
    return { ok: true, value: true };
  }

  setMaxContribution(newMax: bigint): Result<boolean> {
    if (this.caller !== this.state.admin) {
      return { ok: false, value: ERR_NOT_ADMIN };
    }
    if (newMax <= 0n) {
      return { ok: false, value: ERR_INVALID_AMOUNT };
    }
    this.state.maxContribution = newMax;
    return { ok: true, value: true };
  }

  setBaseInterestRate(newRate: bigint): Result<boolean> {
    if (this.caller !== this.state.admin) {
      return { ok: false, value: ERR_NOT_ADMIN };
    }
    if (!(newRate >= 1n && newRate <= 10n)) {
      return { ok: false, value: ERR_INVALID_INTEREST_RATE };
    }
    this.state.baseInterestRate = newRate;
    return { ok: true, value: true };
  }

  setWithdrawalLockPeriod(newPeriod: bigint): Result<boolean> {
    if (this.caller !== this.state.admin) {
      return { ok: false, value: ERR_NOT_ADMIN };
    }
    if (newPeriod <= 0n) {
      return { ok: false, value: ERR_INVALID_DURATION };
    }
    this.state.withdrawalLockPeriod = newPeriod;
    return { ok: true, value: true };
  }

  contributeToPool(amount: bigint): Result<bigint> {
    if (this.state.poolPaused) {
      return { ok: false, value: ERR_POOL_PAUSED };
    }
    if (amount < this.state.minContribution) {
      return { ok: false, value: ERR_INVALID_AMOUNT };
    }
    if (amount > this.state.maxContribution) {
      return { ok: false, value: ERR_MAX_CONTRIB_EXCEEDED };
    }
    if (amount <= 0n) {
      return { ok: false, value: ERR_ZERO_CONTRIBUTION };
    }
    const current = this.state.contributions.get(this.caller) || { amount: 0n, lastContrib: 0n, lockedUntil: 0n };
    const newAmount = current.amount + amount;
    const newLocked = this.blockHeight + this.state.withdrawalLockPeriod;
    this.state.contributions.set(this.caller, { amount: newAmount, lastContrib: this.blockHeight, lockedUntil: newLocked });
    this.state.totalPoolBalance += amount;
    return { ok: true, value: newAmount };
  }

  withdrawFromPool(amount: bigint): Result<bigint> {
    const current = this.state.contributions.get(this.caller);
    if (!current) {
      return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    }
    const userBalance = current.amount;
    const lockedUntil = current.lockedUntil;
    if (this.state.poolPaused) {
      return { ok: false, value: ERR_POOL_PAUSED };
    }
    if (userBalance < amount) {
      return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    }
    if (this.blockHeight < lockedUntil) {
      return { ok: false, value: ERR_WITHDRAWAL_LOCKED };
    }
    if (amount <= 0n) {
      return { ok: false, value: ERR_INVALID_AMOUNT };
    }
    const newBalance = userBalance - amount;
    if (newBalance > 0n) {
      this.state.contributions.set(this.caller, { ...current, amount: newBalance });
    } else {
      this.state.contributions.delete(this.caller);
    }
    this.state.totalPoolBalance -= amount;
    return { ok: true, value: newBalance };
  }

  calculateInterest(principal: bigint, durationBlocks: bigint): Result<bigint> {
    const rate = this.state.baseInterestRate;
    const days = durationBlocks / 144n;
    const interest = (principal * (rate * days)) / 100n;
    return { ok: true, value: interest };
  }

  recordYield(yieldAmount: bigint): Result<boolean> {
    if (this.caller !== this.state.admin) {
      return { ok: false, value: ERR_NOT_ADMIN };
    }
    this.state.historicalYields.set(this.blockHeight.toString(), yieldAmount);
    return { ok: true, value: true };
  }

  getHistoricalYield(timestamp: bigint): Result<bigint | null> {
    const yieldValue = this.state.historicalYields.get(timestamp.toString());
    return { ok: true, value: yieldValue || null };
  }

  updateUnlockTimestamp(newTimestamp: bigint): Result<boolean> {
    if (this.caller !== this.state.admin) {
      return { ok: false, value: ERR_NOT_ADMIN };
    }
    if (newTimestamp < this.state.unlockTimestamp) {
      return { ok: false, value: ERR_UNLOCK_PERIOD_NOT_ENDED };
    }
    this.state.unlockTimestamp = newTimestamp;
    return { ok: true, value: true };
  }

  getUnlockTimestamp(): Result<bigint> {
    return { ok: true, value: this.state.unlockTimestamp };
  }
}

describe("LendingPool", () => {
  let contract: LendingPoolMock;

  beforeEach(() => {
    contract = new LendingPoolMock();
    contract.reset();
    contract.blockHeight = 100n;
  });

  it("contributes to pool successfully", () => {
    const result = contract.contributeToPool(5000n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(5000n);
    expect(contract.state.totalPoolBalance).toBe(5000n);
    const userContrib = contract.getUserContribution("ST1TEST");
    expect(userContrib.ok).toBe(true);
    expect(userContrib.value).toBe(5000n);
    const lockedUntil = contract.getUserLockedUntil("ST1TEST");
    expect(lockedUntil.ok).toBe(true);
    expect(lockedUntil.value).toBe(100n + 144n);
  });

  it("rejects contribution below min", () => {
    const result = contract.contributeToPool(500n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AMOUNT);
  });

  it("rejects contribution above max", () => {
    const result = contract.contributeToPool(200000n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_CONTRIB_EXCEEDED);
  });

  it("rejects contribution when paused", () => {
    contract.pausePool();
    const result = contract.contributeToPool(5000n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_POOL_PAUSED);
  });

  it("withdraws from pool successfully after lock", () => {
    contract.contributeToPool(5000n);
    contract.blockHeight = 300n;
    const result = contract.withdrawFromPool(2000n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(3000n);
    expect(contract.state.totalPoolBalance).toBe(3000n);
  });

  it("rejects withdrawal before lock period", () => {
    contract.contributeToPool(5000n);
    contract.blockHeight = 150n;
    const result = contract.withdrawFromPool(2000n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_WITHDRAWAL_LOCKED);
  });

  it("rejects withdrawal exceeding balance", () => {
    contract.contributeToPool(5000n);
    contract.blockHeight = 300n;
    const result = contract.withdrawFromPool(6000n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INSUFFICIENT_BALANCE);
  });

  it("rejects withdrawal when paused", () => {
    contract.contributeToPool(5000n);
    contract.blockHeight = 300n;
    contract.pausePool();
    const result = contract.withdrawFromPool(2000n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_POOL_PAUSED);
  });

  it("sets admin successfully", () => {
    const result = contract.setAdmin("ST2TEST");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const adminResult = contract.getAdmin();
    expect(adminResult.ok).toBe(true);
    expect(adminResult.value).toBe("ST2TEST");
  });

  it("rejects set admin by non-admin", () => {
    contract.caller = "ST2FAKE";
    const result = contract.setAdmin("ST3TEST");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_ADMIN);
  });

  it("pauses pool successfully", () => {
    const result = contract.pausePool();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const paused = contract.isPaused();
    expect(paused.ok).toBe(true);
    expect(paused.value).toBe(true);
  });

  it("rejects pause by non-admin", () => {
    contract.caller = "ST2FAKE";
    const result = contract.pausePool();
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_ADMIN);
  });

  it("sets min contribution successfully", () => {
    const result = contract.setMinContribution(2000n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const minResult = contract.getMinContribution();
    expect(minResult.ok).toBe(true);
    expect(minResult.value).toBe(2000n);
  });

  it("rejects set min contribution invalid", () => {
    const result = contract.setMinContribution(0n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AMOUNT);
  });

  it("sets base interest rate successfully", () => {
    const result = contract.setBaseInterestRate(5n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const rateResult = contract.getBaseInterestRate();
    expect(rateResult.ok).toBe(true);
    expect(rateResult.value).toBe(5n);
  });

  it("rejects invalid base interest rate", () => {
    const result = contract.setBaseInterestRate(15n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_INTEREST_RATE);
  });

  it("records yield successfully", () => {
    const result = contract.recordYield(100n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const yieldResult = contract.getHistoricalYield(100n);
    expect(yieldResult.ok).toBe(true);
    expect(yieldResult.value).toBe(100n);
  });

  it("rejects record yield by non-admin", () => {
    contract.caller = "ST2FAKE";
    const result = contract.recordYield(100n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_ADMIN);
  });

  it("updates unlock timestamp successfully", () => {
    contract.state.unlockTimestamp = 50n;
    contract.blockHeight = 100n;
    const result = contract.updateUnlockTimestamp(120n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const tsResult = contract.getUnlockTimestamp();
    expect(tsResult.ok).toBe(true);
    expect(tsResult.value).toBe(120n);
  });

  it("rejects update unlock timestamp invalid", () => {
    contract.state.unlockTimestamp = 100n;
    const result = contract.updateUnlockTimestamp(50n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_UNLOCK_PERIOD_NOT_ENDED);
  });

  it("parses uint with Clarity", () => {
    const cv = uintCV(1000n);
    expect(cv.value).toBe(1000n);
  });

  it("gets total pool balance correctly", () => {
    contract.contributeToPool(5000n);
    const balanceResult = contract.getTotalPoolBalance();
    expect(balanceResult.ok).toBe(true);
    expect(balanceResult.value).toBe(5000n);
  });

  it("deletes contribution on full withdrawal", () => {
    contract.contributeToPool(5000n);
    contract.blockHeight = 300n;
    contract.withdrawFromPool(5000n);
    const userContrib = contract.getUserContribution("ST1TEST");
    expect(userContrib.ok).toBe(true);
    expect(userContrib.value).toBe(0n);
    expect(contract.state.contributions.has("ST1TEST")).toBe(false);
  });
});