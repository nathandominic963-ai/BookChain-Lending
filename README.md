# BookChain Lending

## Project Overview

BookChain Lending is a decentralized Web3 platform built on the Stacks blockchain using Clarity smart contracts. It enables users to take out small, low-interest loans specifically for purchasing books, addressing real-world problems such as financial barriers to education for low-income students, limited access to educational resources in underserved communities, and the insecurity of traditional lending systems (e.g., disputes over repayments or collateral). 

By leveraging blockchain, the platform ensures transparency, immutability, and security for all transactions. Books can be represented as NFTs to track ownership and lending history, while loans are collateralized with STX (Stacks' native token) or other assets. Interest rates are fixed low (e.g., 1-2% per loan term) to promote accessibility. The system solves problems like:
- **Affordability**: Micro-loans (e.g., $10-100) with low interest reduce the cost of books for students.
- **Security and Trust**: Blockchain records prevent fraud, automate repayments, and handle defaults via collateral liquidation.
- **Inclusivity**: Peer-to-peer lending model connects lenders directly with borrowers, bypassing traditional banks.
- **Traceability**: NFT-based book tracking reduces piracy and ensures books are used as intended (e.g., for education).

The project involves 6 core smart contracts:
1. **UserRegistry**: Manages user registration and KYC-like verification.
2. **BookNFT**: Mints and manages NFTs representing books.
3. **LendingPool**: Holds funds for loans and manages interest rates.
4. **LoanManager**: Handles loan creation, approval, and tracking.
5. **CollateralVault**: Secures collateral and handles liquidation on default.
6. **RepaymentHandler**: Processes repayments, interest, and penalties.

Deployment: Contracts are deployed on Stacks testnet/mainnet. Frontend (not included) could be built with React and Stacks.js for user interaction.

## Prerequisites
- Stacks CLI for deployment.
- Clarity knowledge for modifications.
- STX for testing on testnet.

## Smart Contracts

### 1. UserRegistry.clar
```clar
(define-constant ERR-UNAUTHORIZED (err u100))
(define-constant ERR-USER-EXISTS (err u101))
(define-constant ERR-INVALID-USER (err u102))

(define-map users principal {registered: bool, verified: bool})

(define-public (register-user)
  (let ((sender tx-sender))
    (asserts! (not (get registered (map-get? users sender))) ERR-USER-EXISTS)
    (map-set users sender {registered: true, verified: false})
    (ok true)
  )
)

(define-public (verify-user (verifier principal))
  (let ((sender tx-sender))
    (asserts! (is-eq sender verifier) ERR-UNAUTHORIZED) ;; Simplified; in production, use admin
    (map-set users verifier {registered: true, verified: true})
    (ok true)
  )
)

(define-read-only (is-user-verified (user principal))
  (get verified (unwrap! (map-get? users user) ERR-INVALID-USER))
)
```

### 2. BookNFT.clar
```clar
(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)

(define-non-fungible-token BookNFT uint)

(define-map tokens uint {owner: principal, book-id: string, loaned: bool})

(define-public (mint-book (book-id string) (recipient principal))
  (let ((next-id (var-get last-token-id))
        (sender tx-sender))
    (asserts! (is-user-verified sender) ERR-INVALID-USER)
    (var-set last-token-id (+ next-id u1))
    (nft-mint? BookNFT next-id recipient)
    (map-set tokens next-id {owner: recipient, book-id: book-id, loaned: false})
    (ok true)
  )
)

(define-read-only (get-book-owner (token-id uint))
  (get owner (map-get? tokens token-id))
)

;; Additional functions for transfer, etc., omitted for brevity
```

### 3. LendingPool.clar
```clar
(define-constant LOW_INTEREST_RATE u2) ;; 2% fixed low rate
(define-constant MAX_LOAN_AMOUNT u10000) ;; In micro-STX, e.g., $100

(define-map pool {principal} uint) ;; User contributions to pool

(define-public (contribute-to-pool (amount uint))
  (let ((sender tx-sender))
    (asserts! (>= amount u1000) ERR-INVALID-AMOUNT) ;; Min contribution
    (try! (contract-call? 'SPX...STX-token transfer amount tx-sender (as-contract tx-sender) none))
    (map-set pool sender (+ (default-to u0 (map-get? pool sender)) amount))
    (ok true)
  )
)

(define-read-only (get-available-funds)
  ;; Simplified; in reality, query contract balance
  (ok u50000) ;; Example
)

(define-read-only (calculate-interest (principal uint) (duration uint)) ;; Duration in blocks
  (* principal (/ (* LOW_INTEREST_RATE duration) u36500)) ;; Approx daily rate
)
```

### 4. LoanManager.clar
```clar
(define-constant ERR-INSUFFICIENT_FUNDS (err u200))
(define-constant ERR-LOAN_ACTIVE (err u201))

(define-map loans uint {borrower: principal, amount: uint, interest: uint, status: (string-ascii 10), book-nft: uint})

(define-public (request-loan (amount uint) (book-nft-id uint))
  (let ((sender tx-sender))
    (asserts! (is-user-verified sender) ERR-INVALID-USER)
    (asserts! (not (has-active-loan? sender)) ERR-LOAN_ACTIVE)
    (asserts! (<= amount MAX_LOAN_AMOUNT) ERR-INVALID-AMOUNT)
    (let ((available (unwrap! (contract-call? .lending-pool get-available-funds) ERR-INSUFFICIENT_FUNDS)))
      (asserts! (>= available amount) ERR-INSUFFICIENT_FUNDS)
      (let ((loan-id (var-get next-loan-id))
            (interest (unwrap! (contract-call? .lending-pool calculate-interest amount u30) (err u0)))) ;; 30-day term
        (var-set next-loan-id (+ loan-id u1))
        (map-set loans loan-id {borrower: sender, amount: amount, interest: interest, status: "pending", book-nft: book-nft-id})
        (ok loan-id)
      )
    )
  )
)

(define-public (approve-loan (loan-id uint))
  ;; Admin or DAO approval logic
  (map-set loans loan-id (merge (get loans loan-id) {status: "active"}))
  (ok true)
)

(define-read-only (has-active-loan? (user principal))
  ;; Iterate map to check; simplified
  false ;; Placeholder
)
```

### 5. CollateralVault.clar
```clar
(define-map collateral {loan-id: uint} uint)

(define-public (deposit-collateral (loan-id uint) (amount uint))
  (let ((sender tx-sender))
    (try! (contract-call? 'SPX...STX-token transfer amount tx-sender (as-contract tx-sender) none))
    (map-set collateral {loan-id: loan-id} amount)
    (ok true)
  )
)

(define-public (liquidate-collateral (loan-id uint))
  (let ((loan (unwrap! (map-get? loans loan-id) ERR-INVALID-LOAN))
        (collateral-amount (default-to u0 (map-get? collateral {loan-id: loan-id}))))
    (asserts! (is-eq (get status loan) "defaulted") ERR-INVALID-STATUS)
    ;; Transfer collateral to lender/pool
    (as-contract (contract-call? 'SPX...STX-token transfer collateral-amount (as-contract tx-sender) ... none))
    (ok true)
  )
)
```

### 6. RepaymentHandler.clar
```clar
(define-constant PENALTY_RATE u5) ;; 5% penalty on default

(define-public (repay-loan (loan-id uint) (amount uint))
  (let ((sender tx-sender)
        (loan (unwrap! (map-get? loans loan-id) ERR-INVALID-LOAN)))
    (asserts! (is-eq sender (get borrower loan)) ERR-UNAUTHORIZED)
    (let ((total-due (+ (get amount loan) (get interest loan))))
      (asserts! (>= amount total-due) ERR-INSUFFICIENT_PAYMENT)
      (try! (contract-call? 'SPX...STX-token transfer total-due tx-sender (as-contract tx-sender) none))
      (map-set loans loan-id (merge loan {status: "repaid"}))
      ;; Release collateral
      (ok true)
    )
  )
)

(define-public (mark-default (loan-id uint))
  ;; After due date check via oracle or block height
  (map-set loans loan-id (merge (get loans loan-id) {status: "defaulted"}))
  (try! (contract-call? .collateral-vault liquidate-collateral loan-id))
  (ok true)
)
```

## Deployment Instructions
1. Install Stacks CLI: `npm install -g @stacks/cli`.
2. Compile contracts: `clarinet integrate`.
3. Deploy to testnet: `clarinet deploy --network testnet`.
4. Interact via Clarinet console or frontend.

## Future Enhancements
- Integrate oracles for real-world book return verification.
- DAO governance for interest rates.
- Cross-chain support for broader collateral.

For issues, open a GitHub issue. License: MIT.