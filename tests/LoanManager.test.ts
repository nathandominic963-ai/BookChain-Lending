import { describe, it, expect, beforeEach } from "vitest";
import { stringAsciiCV, uintCV, boolCV, principalCV, noneCV, someCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_AMOUNT = 101;
const ERR_INVALID_DURATION = 102;
const ERR_INVALID_NFT = 103;
const ERR_LOAN_NOT_FOUND = 104;
const ERR_LOAN_ACTIVE = 105;
const ERR_INSUFFICIENT_FUNDS = 106;
const ERR_INVALID_STATUS = 107;
const ERR_NOT_VERIFIED = 108;
const ERR_INVALID_INTEREST = 109;
const ERR_INVALID_COLLATERAL = 110;
const ERR_AUTHORITY_NOT_SET = 111;
const ERR_INVALID_BLOCK = 112;
const ERR_INVALID_VOTE = 113;
const ERR_VOTING_CLOSED = 114;
const ERR_ALREADY_VOTED = 115;

interface Loan {
  borrower: string;
  amount: number;
  interest: number;
  collateral: number;
  bookNft: number;
  status: string;
  startBlock: number;
  duration: number;
  votesFor: number;
  votesAgainst: number;
  votingDeadline: number;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

interface LendingPoolMock {
  getAvailableFunds: () => Result<number>;
  calculateInterest: (amount: number, duration: number) => Result<number>;
  disburseFunds: (amount: number, borrower: string) => Result<boolean>;
}

interface UserRegistryMock {
  isUserVerified: (user: string) => Result<boolean>;
}

interface BookNFTMock {
  getBookOwner: (bookId: number) => Result<string | null>;
}

interface CollateralVaultMock {
  depositCollateral: (loanId: number, amount: number) => Result<boolean>;
  releaseCollateral: (loanId: number) => Result<boolean>;
  liquidateCollateral: (loanId: number) => Result<boolean>;
}

interface RepaymentHandlerMock {
  processRepayment: (loanId: number, amount: number) => Result<boolean>;
}

class LoanManagerMock {
  state: {
    nextLoanId: number;
    authorityContract: string | null;
    maxLoanAmount: number;
    maxLoanDuration: number;
    minCollateralRatio: number;
    loans: Map<number, Loan>;
    userVotes: Map<string, boolean>;
  } = {
    nextLoanId: 0,
    authorityContract: null,
    maxLoanAmount: 10000,
    maxLoanDuration: 90,
    minCollateralRatio: 150,
    loans: new Map(),
    userVotes: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  lendingPool: LendingPoolMock;
  userRegistry: UserRegistryMock;
  bookNFT: BookNFTMock;
  collateralVault: CollateralVaultMock;
  repaymentHandler: RepaymentHandlerMock;

  constructor() {
    this.lendingPool = {
      getAvailableFunds: () => ({ ok: true, value: 50000 }),
      calculateInterest: (amount: number, duration: number) => ({ ok: true, value: Math.floor(amount * 0.02 * (duration / 30)) }),
      disburseFunds: () => ({ ok: true, value: true }),
    };
    this.userRegistry = {
      isUserVerified: (user: string) => ({ ok: true, value: user !== "ST2FAKE" }),
    };
    this.bookNFT = {
      getBookOwner: (bookId: number) => ({ ok: true, value: bookId < 1000 ? "ST1TEST" : null }),
    };
    this.collateralVault = {
      depositCollateral: () => ({ ok: true, value: true }),
      releaseCollateral: () => ({ ok: true, value: true }),
      liquidateCollateral: () => ({ ok: true, value: true }),
    };
    this.repaymentHandler = {
      processRepayment: () => ({ ok: true, value: true }),
    };
  }

  reset() {
    this.state = {
      nextLoanId: 0,
      authorityContract: null,
      maxLoanAmount: 10000,
      maxLoanDuration: 90,
      minCollateralRatio: 150,
      loans: new Map(),
      userVotes: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (contractPrincipal === "SP000000000000000000002Q6VF78") return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (this.state.authorityContract !== null) return { ok: false, value: ERR_AUTHORITY_NOT_SET };
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setMaxLoanAmount(amount: number): Result<boolean> {
    if (amount <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_SET };
    this.state.maxLoanAmount = amount;
    return { ok: true, value: true };
  }

  setMaxLoanDuration(duration: number): Result<boolean> {
    if (duration <= 0) return { ok: false, value: ERR_INVALID_DURATION };
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_SET };
    this.state.maxLoanDuration = duration;
    return { ok: true, value: true };
  }

  setMinCollateralRatio(ratio: number): Result<boolean> {
    if (ratio <= 100) return { ok: false, value: ERR_INVALID_COLLATERAL };
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_SET };
    this.state.minCollateralRatio = ratio;
    return { ok: true, value: true };
  }

  requestLoan(amount: number, duration: number, bookNftId: number, collateral: number): Result<number> {
    if (!this.userRegistry.isUserVerified(this.caller).value) return { ok: false, value: ERR_NOT_VERIFIED };
    if (this.hasActiveLoan(this.caller)) return { ok: false, value: ERR_LOAN_ACTIVE };
    if (amount <= 0 || amount > this.state.maxLoanAmount) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (duration <= 0 || duration > this.state.maxLoanDuration) return { ok: false, value: ERR_INVALID_DURATION };
    if (!this.bookNFT.getBookOwner(bookNftId).value) return { ok: false, value: ERR_INVALID_NFT };
    if (collateral < (amount * this.state.minCollateralRatio) / 100) return { ok: false, value: ERR_INVALID_COLLATERAL };
    if (this.lendingPool.getAvailableFunds().value < amount) return { ok: false, value: ERR_INSUFFICIENT_FUNDS };
    if (!this.collateralVault.depositCollateral(this.state.nextLoanId, collateral).value) return { ok: false, value: ERR_INVALID_COLLATERAL };

    const interest = this.lendingPool.calculateInterest(amount, duration);
    if (!interest.ok) return { ok: false, value: ERR_INVALID_INTEREST };

    const loanId = this.state.nextLoanId;
    this.state.loans.set(loanId, {
      borrower: this.caller,
      amount,
      interest: interest.value,
      collateral,
      bookNft: bookNftId,
      status: "pending",
      startBlock: this.blockHeight,
      duration,
      votesFor: 0,
      votesAgainst: 0,
      votingDeadline: this.blockHeight + 100,
    });
    this.state.nextLoanId++;
    return { ok: true, value: loanId };
  }

  voteOnLoan(loanId: number, approve: boolean): Result<boolean> {
    const loan = this.state.loans.get(loanId);
    if (!loan) return { ok: false, value: ERR_LOAN_NOT_FOUND };
    if (!this.userRegistry.isUserVerified(this.caller).value) return { ok: false, value: ERR_NOT_VERIFIED };
    if (loan.status !== "pending") return { ok: false, value: ERR_INVALID_STATUS };
    if (this.blockHeight > loan.votingDeadline) return { ok: false, value: ERR_VOTING_CLOSED };
    const voteKey = `${loanId}-${this.caller}`;
    if (this.state.userVotes.has(voteKey)) return { ok: false, value: ERR_ALREADY_VOTED };

    this.state.userVotes.set(voteKey, approve);
    this.state.loans.set(loanId, {
      ...loan,
      votesFor: approve ? loan.votesFor + 1 : loan.votesFor,
      votesAgainst: !approve ? loan.votesAgainst + 1 : loan.votesAgainst,
    });
    return { ok: true, value: true };
  }

  finalizeLoan(loanId: number): Result<boolean> {
    const loan = this.state.loans.get(loanId);
    if (!loan) return { ok: false, value: ERR_LOAN_NOT_FOUND };
    if (this.blockHeight <= loan.votingDeadline) return { ok: false, value: ERR_INVALID_BLOCK };
    if (loan.status !== "pending") return { ok: false, value: ERR_INVALID_STATUS };

    const totalVotes = loan.votesFor + loan.votesAgainst;
    if (totalVotes > 0 && (loan.votesFor * 100) / totalVotes >= 75) {
      this.state.loans.set(loanId, { ...loan, status: "active" });
      if (!this.lendingPool.disburseFunds(loan.amount, loan.borrower).value) return { ok: false, value: ERR_INSUFFICIENT_FUNDS };
      return { ok: true, value: true };
    } else {
      this.state.loans.set(loanId, { ...loan, status: "rejected" });
      this.collateralVault.releaseCollateral(loanId);
      return { ok: true, value: false };
    }
  }

  repayLoan(loanId: number, amount: number): Result<boolean> {
    const loan = this.state.loans.get(loanId);
    if (!loan) return { ok: false, value: ERR_LOAN_NOT_FOUND };
    if (loan.borrower !== this.caller) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (loan.status !== "active") return { ok: false, value: ERR_INVALID_STATUS };
    const totalDue = loan.amount + loan.interest;
    if (amount < totalDue) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (!this.repaymentHandler.processRepayment(loanId, amount).value) return { ok: false, value: ERR_INVALID_AMOUNT };

    this.state.loans.set(loanId, { ...loan, status: "repaid" });
    this.collateralVault.releaseCollateral(loanId);
    return { ok: true, value: true };
  }

  markLoanDefault(loanId: number): Result<boolean> {
    const loan = this.state.loans.get(loanId);
    if (!loan) return { ok: false, value: ERR_LOAN_NOT_FOUND };
    if (this.blockHeight <= loan.startBlock + loan.duration) return { ok: false, value: ERR_INVALID_BLOCK };
    if (loan.status !== "active") return { ok: false, value: ERR_INVALID_STATUS };

    this.state.loans.set(loanId, { ...loan, status: "defaulted" });
    this.collateralVault.liquidateCollateral(loanId);
    return { ok: true, value: true };
  }

  hasActiveLoan(user: string): boolean {
    for (const [_, loan] of this.state.loans) {
      if (loan.borrower === user && loan.status === "active") return true;
    }
    return false;
  }
}

describe("LoanManager", () => {
  let contract: LoanManagerMock;

  beforeEach(() => {
    contract = new LoanManagerMock();
    contract.reset();
  });

  it("sets authority contract successfully", () => {
    const result = contract.setAuthorityContract("ST2TEST");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.authorityContract).toBe("ST2TEST");
  });

  it("rejects invalid authority contract", () => {
    const result = contract.setAuthorityContract("SP000000000000000000002Q6VF78");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("sets max loan amount successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setMaxLoanAmount(20000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.maxLoanAmount).toBe(20000);
  });

  it("rejects max loan amount without authority", () => {
    const result = contract.setMaxLoanAmount(20000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_AUTHORITY_NOT_SET);
  });

  it("creates loan successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.requestLoan(1000, 30, 1, 1500);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);

    const loan = contract.state.loans.get(0);
    expect(loan?.borrower).toBe("ST1TEST");
    expect(loan?.amount).toBe(1000);
    expect(loan?.interest).toBe(20);
    expect(loan?.collateral).toBe(1500);
    expect(loan?.bookNft).toBe(1);
    expect(loan?.status).toBe("pending");
    expect(loan?.startBlock).toBe(0);
    expect(loan?.duration).toBe(30);
    expect(loan?.votingDeadline).toBe(100);
  });

  it("rejects loan for unverified user", () => {
    contract.caller = "ST2FAKE";
    const result = contract.requestLoan(1000, 30, 1, 1500);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_VERIFIED);
  });

  it("rejects loan with active loan", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.requestLoan(1000, 30, 1, 1500);
    contract.voteOnLoan(0, true);
    contract.blockHeight = 101;
    contract.finalizeLoan(0);
    const result = contract.requestLoan(2000, 30, 2, 3000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_LOAN_ACTIVE);
  });

  it("rejects invalid loan amount", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.requestLoan(20000, 30, 1, 3000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AMOUNT);
  });

  it("rejects invalid duration", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.requestLoan(1000, 100, 1, 1500);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_DURATION);
  });

  it("rejects invalid NFT", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.requestLoan(1000, 30, 1000, 1500);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_NFT);
  });

  it("rejects insufficient collateral", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.requestLoan(1000, 30, 1, 1000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_COLLATERAL);
  });

  it("votes on loan successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.requestLoan(1000, 30, 1, 1500);
    const result = contract.voteOnLoan(0, true);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const loan = contract.state.loans.get(0);
    expect(loan?.votesFor).toBe(1);
  });

  it("rejects vote for non-existent loan", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.voteOnLoan(99, true);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_LOAN_NOT_FOUND);
  });

  it("rejects vote after deadline", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.requestLoan(1000, 30, 1, 1500);
    contract.blockHeight = 101;
    const result = contract.voteOnLoan(0, true);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_VOTING_CLOSED);
  });

  it("rejects double voting", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.requestLoan(1000, 30, 1, 1500);
    contract.voteOnLoan(0, true);
    const result = contract.voteOnLoan(0, false);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ALREADY_VOTED);
  });

  it("finalizes loan as approved", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.requestLoan(1000, 30, 1, 1500);
    contract.voteOnLoan(0, true);
    contract.blockHeight = 101;
    const result = contract.finalizeLoan(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const loan = contract.state.loans.get(0);
    expect(loan?.status).toBe("active");
  });

  it("finalizes loan as rejected", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.requestLoan(1000, 30, 1, 1500);
    contract.voteOnLoan(0, false);
    contract.blockHeight = 101;
    const result = contract.finalizeLoan(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(false);
    const loan = contract.state.loans.get(0);
    expect(loan?.status).toBe("rejected");
  });

  it("repays loan successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.requestLoan(1000, 30, 1, 1500);
    contract.voteOnLoan(0, true);
    contract.blockHeight = 101;
    contract.finalizeLoan(0);
    const result = contract.repayLoan(0, 1020);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const loan = contract.state.loans.get(0);
    expect(loan?.status).toBe("repaid");
  });

  it("rejects repayment by non-borrower", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.requestLoan(1000, 30, 1, 1500);
    contract.voteOnLoan(0, true);
    contract.blockHeight = 101;
    contract.finalizeLoan(0);
    contract.caller = "ST2FAKE";
    const result = contract.repayLoan(0, 1020);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("marks loan as defaulted", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.requestLoan(1000, 30, 1, 1500);
    contract.voteOnLoan(0, true);
    contract.blockHeight = 101;
    contract.finalizeLoan(0);
    contract.blockHeight = 131;
    const result = contract.markLoanDefault(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const loan = contract.state.loans.get(0);
    expect(loan?.status).toBe("defaulted");
  });
});