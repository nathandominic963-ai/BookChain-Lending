import { describe, it, expect, beforeEach } from "vitest";
import { stringAsciiCV, uintCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_LOAN_ID = 101;
const ERR_INSUFFICIENT_COLLATERAL = 102;
const ERR_INVALID_AMOUNT = 103;
const ERR_LOAN_NOT_FOUND = 104;
const ERR_COLLATERAL_LOCKED = 105;
const ERR_INVALID_STATUS = 106;
const ERR_OVER_COLLATERALIZATION = 107;
const ERR_WITHDRAWAL_EXCEEDS = 108;
const ERR_LIQUIDATION_FAILED = 109;
const ERR_ZERO_AMOUNT = 110;
const ERR_MAX_COLLATERAL_EXCEEDED = 111;
const ERR_INVALID_CURRENCY = 112;
const ERR_TIMESTAMP_MISMATCH = 113;
const ERR_AUTHORITY_NOT_SET = 114;
const ERR_RATIO_BELOW_THRESHOLD = 115;
const ERR_TRANSFER_FAILED = 116;

interface Collateral {
  amount: number;
  currency: string;
  depositedAt: number;
  depositor: string;
  locked: boolean;
}

interface LoanCollateralSum {
  totalAmount: number;
  totalValue: number;
  numCollaterals: number;
}

interface LoanStatus {
  status: string;
  value: number;
  updatedAt: number;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class CollateralVaultMock {
  state: {
    authority: string;
    minCollateralRatio: number;
    maxCollateralPerLoan: number;
    liquidationPenalty: number;
    nextCollateralId: number;
    collaterals: Map<string, Collateral>;
    loanCollateralSums: Map<string, LoanCollateralSum>;
    loanStatuses: Map<string, LoanStatus>;
    currencyOracles: Map<string, string>;
  } = {
    authority: "ST1TEST",
    minCollateralRatio: 150,
    maxCollateralPerLoan: 1000000,
    liquidationPenalty: 5,
    nextCollateralId: 0,
    collaterals: new Map(),
    loanCollateralSums: new Map(),
    loanStatuses: new Map(),
    currencyOracles: new Map([["STX", "ST1ORACLE"], ["sBTC", "ST1ORACLE"]]),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  stxTransfers: Array<{ amount: number; from: string; to: string | null }> = [];
  oraclePrices: Map<string, number> = new Map([["STX", 1], ["sBTC", 50000]]);

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      authority: "ST1TEST",
      minCollateralRatio: 150,
      maxCollateralPerLoan: 1000000,
      liquidationPenalty: 5,
      nextCollateralId: 0,
      collaterals: new Map(),
      loanCollateralSums: new Map(),
      loanStatuses: new Map(),
      currencyOracles: new Map([["STX", "ST1ORACLE"], ["sBTC", "ST1ORACLE"]]),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.stxTransfers = [];
    this.oraclePrices = new Map([["STX", 1], ["sBTC", 50000]]);
  }

  setAuthority(newAuth: string): Result<boolean> {
    if (this.caller !== this.state.authority) return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.authority = newAuth;
    return { ok: true, value: true };
  }

  setMinCollateralRatio(ratio: number): Result<boolean> {
    if (this.caller !== this.state.authority) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (ratio < 100 || ratio > 300) return { ok: false, value: ERR_INVALID_AMOUNT };
    this.state.minCollateralRatio = ratio;
    return { ok: true, value: true };
  }

  setMaxCollateralPerLoan(max: number): Result<boolean> {
    if (this.caller !== this.state.authority) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (max <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    this.state.maxCollateralPerLoan = max;
    return { ok: true, value: true };
  }

  setLiquidationPenalty(penalty: number): Result<boolean> {
    if (this.caller !== this.state.authority) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (penalty > 10) return { ok: false, value: ERR_INVALID_PENALTY };
    this.state.liquidationPenalty = penalty;
    return { ok: true, value: true };
  }

  setCurrencyOracle(currency: string, oracle: string): Result<boolean> {
    if (this.caller !== this.state.authority) return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.currencyOracles.set(currency, oracle);
    return { ok: true, value: true };
  }

  getCollateral(loanId: number, collateralId: number): Collateral | null {
    return this.state.collaterals.get(`${loanId}-${collateralId}`) || null;
  }

  getLoanCollateralSum(loanId: number): LoanCollateralSum | null {
    return this.state.loanCollateralSums.get(`${loanId}`) || null;
  }

  getLoanStatus(loanId: number): LoanStatus | null {
    return this.state.loanStatuses.get(`${loanId}`) || null;
  }

  getCurrentPrice(currency: string, amount: number): Result<number> {
    const price = this.oraclePrices.get(currency) || 0;
    return { ok: true, value: price };
  }

  depositCollateral(loanId: number, amount: number, currency: string): Result<number> {
    if (amount <= 0) return { ok: false, value: ERR_ZERO_AMOUNT };
    if (!["STX", "sBTC"].includes(currency)) return { ok: false, value: ERR_INVALID_CURRENCY };
    if (!this.stxTransfers.length) this.stxTransfers.push({ amount, from: this.caller, to: null });
    const priceResult = this.getCurrentPrice(currency, amount);
    if (!priceResult.ok) return priceResult;
    const collateralValue = amount * priceResult.value;
    if (this.state.nextCollateralId >= 100) return { ok: false, value: ERR_MAX_COLLATERAL_EXCEEDED };
    const loanStatus = this.getLoanStatus(loanId);
    if (!loanStatus) return { ok: false, value: ERR_LOAN_NOT_FOUND };
    const currentSum = this.getLoanCollateralSum(loanId) || { totalAmount: 0, totalValue: 0, numCollaterals: 0 };
    const totalValue = currentSum.totalValue + collateralValue;
    const ratio = (totalValue / loanStatus.value) * 100;
    if (ratio < this.state.minCollateralRatio) return { ok: false, value: ERR_RATIO_BELOW_THRESHOLD };
    const id = this.state.nextCollateralId;
    const key = `${loanId}-${id}`;
    this.state.collaterals.set(key, {
      amount,
      currency,
      depositedAt: this.blockHeight,
      depositor: this.caller,
      locked: false,
    });
    this.state.loanCollateralSums.set(`${loanId}`, {
      totalAmount: currentSum.totalAmount + amount,
      totalValue: totalValue,
      numCollaterals: currentSum.numCollaterals + 1,
    });
    this.state.nextCollateralId++;
    return { ok: true, value: id };
  }

  withdrawCollateral(loanId: number, collateralId: number, amount: number): Result<boolean> {
    const key = `${loanId}-${collateralId}`;
    const collateral = this.state.collaterals.get(key);
    if (!collateral) return { ok: false, value: ERR_INVALID_LOAN_ID };
    if (this.caller !== collateral.depositor) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (collateral.locked) return { ok: false, value: ERR_COLLATERAL_LOCKED };
    const loanStatus = this.getLoanStatus(loanId);
    if (!loanStatus || loanStatus.status !== "active") return { ok: false, value: ERR_INVALID_STATUS };
    if (amount > collateral.amount) return { ok: false, value: ERR_WITHDRAWAL_EXCEEDS };
    const priceResult = this.getCurrentPrice(collateral.currency, amount);
    if (!priceResult.ok) return priceResult;
    const withdrawalValue = amount * priceResult.value;
    const currentSum = this.getLoanCollateralSum(loanId)!;
    const totalValue = currentSum.totalValue - withdrawalValue;
    const ratio = (totalValue / loanStatus.value) * 100;
    if (ratio < this.state.minCollateralRatio) return { ok: false, value: ERR_RATIO_BELOW_THRESHOLD };
    const remainingAmount = collateral.amount - amount;
    if (remainingAmount === 0) {
      this.state.collaterals.delete(key);
    } else {
      this.state.collaterals.set(key, { ...collateral, amount: remainingAmount });
    }
    this.state.loanCollateralSums.set(`${loanId}`, {
      totalAmount: currentSum.totalAmount - amount,
      totalValue: totalValue,
      numCollaterals: remainingAmount === 0 ? currentSum.numCollaterals - 1 : currentSum.numCollaterals,
    });
    this.stxTransfers.push({ amount, from: null, to: this.caller });
    return { ok: true, value: true };
  }

  lockCollateral(loanId: number, collateralId: number): Result<boolean> {
    const key = `${loanId}-${collateralId}`;
    const collateral = this.state.collaterals.get(key);
    if (!collateral) return { ok: false, value: ERR_INVALID_LOAN_ID };
    if (this.caller !== this.state.authority) return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.collaterals.set(key, { ...collateral, locked: true });
    return { ok: true, value: true };
  }

  unlockCollateral(loanId: number, collateralId: number): Result<boolean> {
    const key = `${loanId}-${collateralId}`;
    const collateral = this.state.collaterals.get(key);
    if (!collateral) return { ok: false, value: ERR_INVALID_LOAN_ID };
    if (this.caller !== this.state.authority) return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.collaterals.set(key, { ...collateral, locked: false });
    return { ok: true, value: true };
  }

  updateLoanStatus(loanId: number, newStatus: string, value: number): Result<boolean> {
    if (this.caller !== this.state.authority) return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.loanStatuses.set(`${loanId}`, { status: newStatus, value, updatedAt: this.blockHeight });
    return { ok: true, value: true };
  }

  liquidateCollateral(loanId: number): Result<number> {
    const loanStatus = this.getLoanStatus(loanId);
    if (!loanStatus) return { ok: false, value: ERR_LOAN_NOT_FOUND };
    const loanSum = this.getLoanCollateralSum(loanId);
    if (!loanSum || loanSum.totalAmount === 0) return { ok: false, value: ERR_INSUFFICIENT_COLLATERAL };
    if (this.caller !== this.state.authority) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (loanStatus.status !== "defaulted") return { ok: false, value: ERR_INVALID_STATUS };
    const totalAmount = loanSum.totalAmount;
    const totalValue = loanSum.totalValue;
    const penaltyAmount = (totalValue * this.state.liquidationPenalty) / 100;
    this.stxTransfers.push({ amount: totalAmount, from: null, to: "lending-pool" });
    this.state.loanCollateralSums.set(`${loanId}`, { totalAmount: 0, totalValue: 0, numCollaterals: 0 });
    this.state.loanStatuses.delete(`${loanId}`);
    this.state.collaterals.clear();
    return { ok: true, value: totalAmount };
  }

  isOverCollateralized(loanId: number): Result<boolean> {
    const loanSum = this.getLoanCollateralSum(loanId);
    const loanStatus = this.getLoanStatus(loanId);
    if (!loanSum || !loanStatus) return { ok: true, value: false };
    const ratio = (loanSum.totalValue / loanStatus.value) * 100;
    return { ok: true, value: ratio >= this.state.minCollateralRatio };
  }
}

describe("CollateralVault", () => {
  let contract: CollateralVaultMock;

  beforeEach(() => {
    contract = new CollateralVaultMock();
    contract.reset();
    contract.updateLoanStatus(1, "active", 1000);
  });

  it("deposits collateral successfully", () => {
    const result = contract.depositCollateral(1, 2000, "STX");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    const collateral = contract.getCollateral(1, 0);
    expect(collateral?.amount).toBe(2000);
    expect(collateral?.currency).toBe("STX");
    expect(collateral?.depositor).toBe("ST1TEST");
    expect(collateral?.locked).toBe(false);
    const sum = contract.getLoanCollateralSum(1);
    expect(sum?.totalAmount).toBe(2000);
    expect(sum?.totalValue).toBe(2000);
    expect(sum?.numCollaterals).toBe(1);
    expect(contract.stxTransfers).toEqual([{ amount: 2000, from: "ST1TEST", to: null }]);
  });

  it("rejects deposit with zero amount", () => {
    const result = contract.depositCollateral(1, 0, "STX");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ZERO_AMOUNT);
  });

  it("rejects deposit with invalid currency", () => {
    const result = contract.depositCollateral(1, 1000, "INVALID");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_CURRENCY);
  });

  it("rejects deposit below collateral ratio", () => {
    contract.state.minCollateralRatio = 300;
    const result = contract.depositCollateral(1, 500, "STX");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_RATIO_BELOW_THRESHOLD);
  });

  it("withdraws collateral successfully", () => {
    contract.depositCollateral(1, 2000, "STX");
    const result = contract.withdrawCollateral(1, 0, 500);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const collateral = contract.getCollateral(1, 0);
    expect(collateral?.amount).toBe(1500);
    const sum = contract.getLoanCollateralSum(1);
    expect(sum?.totalAmount).toBe(1500);
    expect(sum?.totalValue).toBe(1500);
    expect(contract.stxTransfers).toEqual([
      { amount: 2000, from: "ST1TEST", to: null },
      { amount: 500, from: null, to: "ST1TEST" }
    ]);
  });

  it("rejects withdrawal exceeding amount", () => {
    contract.depositCollateral(1, 2000, "STX");
    const result = contract.withdrawCollateral(1, 0, 2500);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_WITHDRAWAL_EXCEEDS);
  });

  it("rejects withdrawal of locked collateral", () => {
    contract.depositCollateral(1, 2000, "STX");
    contract.lockCollateral(1, 0);
    const result = contract.withdrawCollateral(1, 0, 500);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_COLLATERAL_LOCKED);
  });

  it("locks collateral successfully", () => {
    contract.depositCollateral(1, 2000, "STX");
    contract.caller = "ST1TEST";
    const result = contract.lockCollateral(1, 0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const collateral = contract.getCollateral(1, 0);
    expect(collateral?.locked).toBe(true);
  });

  it("rejects lock by unauthorized", () => {
    contract.depositCollateral(1, 2000, "STX");
    contract.caller = "ST2FAKE";
    const result = contract.lockCollateral(1, 0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("unlocks collateral successfully", () => {
    contract.depositCollateral(1, 2000, "STX");
    contract.lockCollateral(1, 0);
    const result = contract.unlockCollateral(1, 0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const collateral = contract.getCollateral(1, 0);
    expect(collateral?.locked).toBe(false);
  });

  it("updates loan status successfully", () => {
    const result = contract.updateLoanStatus(1, "defaulted", 1200);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const status = contract.getLoanStatus(1);
    expect(status?.status).toBe("defaulted");
    expect(status?.value).toBe(1200);
  });

  it("liquidates collateral successfully", () => {
    contract.depositCollateral(1, 2000, "STX");
    contract.updateLoanStatus(1, "defaulted", 1000);
    const result = contract.liquidateCollateral(1);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2000);
    const sum = contract.getLoanCollateralSum(1);
    expect(sum?.totalAmount).toBe(0);
    expect(sum?.totalValue).toBe(0);
    expect(contract.stxTransfers).toEqual([
      { amount: 2000, from: "ST1TEST", to: null },
      { amount: 2000, from: null, to: "lending-pool" }
    ]);
  });

  it("rejects liquidation if not defaulted", () => {
    contract.depositCollateral(1, 2000, "STX");
    const result = contract.liquidateCollateral(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_STATUS);
  });

  it("checks over-collateralization correctly", () => {
    contract.depositCollateral(1, 2000, "STX");
    const result = contract.isOverCollateralized(1);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
  });

  it("sets min collateral ratio successfully", () => {
    const result = contract.setMinCollateralRatio(200);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.minCollateralRatio).toBe(200);
  });

  it("rejects setting invalid min collateral ratio", () => {
    const result = contract.setMinCollateralRatio(50);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AMOUNT);
  });

  it("parses parameters with Clarity types", () => {
    const loanId = uintCV(1);
    const amount = uintCV(1000);
    const currency = stringAsciiCV("STX");
    expect(loanId.value.toString()).toBe("1");
    expect(amount.value.toString()).toBe("1000");
    expect(currency.value).toBe("STX");
  });
});