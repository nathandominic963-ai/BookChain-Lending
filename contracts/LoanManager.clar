(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-AMOUNT u101)
(define-constant ERR-INVALID-DURATION u102)
(define-constant ERR-INVALID-NFT u103)
(define-constant ERR-LOAN-NOT-FOUND u104)
(define-constant ERR-LOAN-ACTIVE u105)
(define-constant ERR-INSUFFICIENT-FUNDS u106)
(define-constant ERR-INVALID-STATUS u107)
(define-constant ERR-NOT-VERIFIED u108)
(define-constant ERR-INVALID-INTEREST u109)
(define-constant ERR-INVALID-COLLATERAL u110)
(define-constant ERR-AUTHORITY-NOT-SET u111)
(define-constant ERR-INVALID-BLOCK u112)
(define-constant ERR-INVALID-VOTE u113)
(define-constant ERR-VOTING-CLOSED u114)
(define-constant ERR-ALREADY-VOTED u115)

(define-data-var next-loan-id uint u0)
(define-data-var authority-contract (optional principal) none)
(define-data-var max-loan-amount uint u10000)
(define-data-var max-loan-duration uint u90)
(define-data-var min-collateral-ratio uint u150)

(define-map loans
  uint
  {
    borrower: principal,
    amount: uint,
    interest: uint,
    collateral: uint,
    book-nft: uint,
    status: (string-ascii 10),
    start-block: uint,
    duration: uint,
    votes-for: uint,
    votes-against: uint,
    voting-deadline: uint
  }
)

(define-map user-votes
  { loan-id: uint, voter: principal }
  bool
)

(define-read-only (get-loan (loan-id uint))
  (map-get? loans loan-id)
)

(define-read-only (has-active-loan (user principal))
  (fold check-user-loan (map-get? loans user) false)
)

(define-read-only (get-available-funds)
  (contract-call? .lending-pool get-available-funds)
)

(define-read-only (calculate-interest (amount uint) (duration uint))
  (contract-call? .lending-pool calculate-interest amount duration)
)

(define-private (check-user-loan (loan-id uint) (acc bool))
  (let ((loan (map-get? loans loan-id)))
    (or acc (and (is-some loan) (is-eq (get status loan) "active")))
  )
)

(define-private (validate-amount (amount uint))
  (if (and (> amount u0) (<= amount (var-get max-loan-amount)))
    (ok true)
    (err ERR-INVALID-AMOUNT)
  )
)

(define-private (validate-duration (duration uint))
  (if (and (> duration u0) (<= duration (var-get max-loan-duration)))
    (ok true)
    (err ERR-INVALID-DURATION)
  )
)

(define-private (validate-nft (book-nft-id uint))
  (let ((owner (contract-call? .book-nft get-book-owner book-nft-id)))
    (if (is-some owner)
      (ok true)
      (err ERR-INVALID-NFT)
    )
  )
)

(define-private (validate-collateral (amount uint) (collateral uint))
  (if (>= collateral (/ (* amount (var-get min-collateral-ratio)) u100))
    (ok true)
    (err ERR-INVALID-COLLATERAL)
  )
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (asserts! (not (is-eq contract-principal 'SP000000000000000000002Q6VF78)) ERR-NOT-AUTHORIZED)
    (asserts! (is-none (var-get authority-contract)) ERR-AUTHORITY-NOT-SET)
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-max-loan-amount (amount uint))
  (begin
    (asserts! (> amount u0) ERR-INVALID-AMOUNT)
    (asserts! (is-some (var-get authority-contract)) ERR-AUTHORITY-NOT-SET)
    (var-set max-loan-amount amount)
    (ok true)
  )
)

(define-public (set-max-loan-duration (duration uint))
  (begin
    (asserts! (> duration u0) ERR-INVALID-DURATION)
    (asserts! (is-some (var-get authority-contract)) ERR-AUTHORITY-NOT-SET)
    (var-set max-loan-duration duration)
    (ok true)
  )
)

(define-public (set-min-collateral-ratio (ratio uint))
  (begin
    (asserts! (> ratio u100) ERR-INVALID-COLLATERAL)
    (asserts! (is-some (var-get authority-contract)) ERR-AUTHORITY-NOT-SET)
    (var-set min-collateral-ratio ratio)
    (ok true)
  )
)

(define-public (request-loan (amount uint) (duration uint) (book-nft-id uint) (collateral uint))
  (let
    (
      (sender tx-sender)
      (loan-id (var-get next-loan-id))
      (interest (unwrap! (calculate-interest amount duration) ERR-INVALID-INTEREST))
      (available-funds (unwrap! (get-available-funds) ERR-INSUFFICIENT-FUNDS))
    )
    (asserts! (contract-call? .user-registry is-user-verified sender) ERR-NOT-VERIFIED)
    (asserts! (not (has-active-loan sender)) ERR-LOAN-ACTIVE)
    (try! (validate-amount amount))
    (try! (validate-duration duration))
    (try! (validate-nft book-nft-id))
    (try! (validate-collateral amount collateral))
    (asserts! (>= available-funds amount) ERR-INSUFFICIENT-FUNDS)
    (try! (contract-call? .collateral-vault deposit-collateral loan-id collateral))
    (map-set loans loan-id
      {
        borrower: sender,
        amount: amount,
        interest: interest,
        collateral: collateral,
        book-nft: book-nft-id,
        status: "pending",
        start-block: block-height,
        duration: duration,
        votes-for: u0,
        votes-against: u0,
        voting-deadline: (+ block-height u100)
      }
    )
    (var-set next-loan-id (+ loan-id u1))
    (print { event: "loan-requested", id: loan-id })
    (ok loan-id)
  )
)

(define-public (vote-on-loan (loan-id uint) (approve bool))
  (let
    (
      (sender tx-sender)
      (loan (unwrap! (map-get? loans loan-id) ERR-LOAN-NOT-FOUND))
      (vote-key { loan-id: loan-id, voter: sender })
    )
    (asserts! (contract-call? .user-registry is-user-verified sender) ERR-NOT-VERIFIED)
    (asserts! (is-eq (get status loan) "pending") ERR-INVALID-STATUS)
    (asserts! (<= block-height (get voting-deadline loan)) ERR-VOTING-CLOSED)
    (asserts! (is-none (map-get? user-votes vote-key)) ERR-ALREADY-VOTED)
    (map-set user-votes vote-key approve)
    (map-set loans loan-id
      (merge loan
        {
          votes-for: (if approve (+ (get votes-for loan) u1) (get votes-for loan)),
          votes-against: (if (not approve) (+ (get votes-against loan) u1) (get votes-against loan))
        }
      )
    )
    (print { event: "vote-cast", loan-id: loan-id, approve: approve })
    (ok true)
  )
)

(define-public (finalize-loan (loan-id uint))
  (let
    (
      (loan (unwrap! (map-get? loans loan-id) ERR-LOAN-NOT-FOUND))
      (total-votes (+ (get votes-for loan) (get votes-against loan)))
    )
    (asserts! (> block-height (get voting-deadline loan)) ERR-INVALID-BLOCK)
    (asserts! (is-eq (get status loan) "pending") ERR-INVALID-STATUS)
    (if (and (> total-votes u0) (>= (/ (* (get votes-for loan) u100) total-votes) u75))
      (begin
        (map-set loans loan-id (merge loan { status: "active" }))
        (try! (contract-call? .lending-pool disburse-funds (get amount loan) (get borrower loan)))
        (print { event: "loan-approved", id: loan-id })
        (ok true)
      )
      (begin
        (map-set loans loan-id (merge loan { status: "rejected" }))
        (try! (contract-call? .collateral-vault release-collateral loan-id))
        (print { event: "loan-rejected", id: loan-id })
        (ok false)
      )
    )
  )
)

(define-public (repay-loan (loan-id uint) (amount uint))
  (let
    (
      (sender tx-sender)
      (loan (unwrap! (map-get? loans loan-id) ERR-LOAN-NOT-FOUND))
      (total-due (+ (get amount loan) (get interest loan)))
    )
    (asserts! (is-eq sender (get borrower loan)) ERR-NOT-AUTHORIZED)
    (asserts! (is-eq (get status loan) "active") ERR-INVALID-STATUS)
    (asserts! (>= amount total-due) ERR-INVALID-AMOUNT)
    (try! (contract-call? .repayment-handler process-repayment loan-id amount))
    (map-set loans loan-id (merge loan { status: "repaid" }))
    (try! (contract-call? .collateral-vault release-collateral loan-id))
    (print { event: "loan-repaid", id: loan-id })
    (ok true)
  )
)

(define-public (mark-loan-default (loan-id uint))
  (let
    (
      (loan (unwrap! (map-get? loans loan-id) ERR-LOAN-NOT-FOUND))
      (due-block (+ (get start-block loan) (get duration loan)))
    )
    (asserts! (> block-height due-block) ERR-INVALID-BLOCK)
    (asserts! (is-eq (get status loan) "active") ERR-INVALID-STATUS)
    (map-set loans loan-id (merge loan { status: "defaulted" }))
    (try! (contract-call? .collateral-vault liquidate-collateral loan-id))
    (print { event: "loan-defaulted", id: loan-id })
    (ok true)
  )
)