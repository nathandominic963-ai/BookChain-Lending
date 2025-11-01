(define-constant ERR-NOT-AUTHORIZED (err u100))
(define-constant ERR-INVALID-LOAN-ID (err u101))
(define-constant ERR-INSUFFICIENT-COLLATERAL (err u102))
(define-constant ERR-INVALID-AMOUNT (err u103))
(define-constant ERR-LOAN-NOT-FOUND (err u104))
(define-constant ERR-COLLATERAL-LOCKED (err u105))
(define-constant ERR-INVALID-STATUS (err u106))
(define-constant ERR-OVER-COLLATERALIZATION (err u107))
(define-constant ERR-WITHDRAWAL-EXCEEDS (err u108))
(define-constant ERR-LIQUIDATION-FAILED (err u109))
(define-constant ERR-ZERO-AMOUNT (err u110))
(define-constant ERR-MAX-COLLATERAL-EXCEEDED (err u111))
(define-constant ERR-INVALID-CURRENCY (err u112))
(define-constant ERR-TIMESTAMP-MISMATCH (err u113))
(define-constant ERR-AUTHORITY-NOT-SET (err u114))
(define-constant ERR-RATIO-BELOW-THRESHOLD (err u115))
(define-constant ERR-TRANSFER-FAILED (err u116))

(define-data-var authority principal tx-sender)
(define-data-var min-collateral-ratio uint u150)
(define-data-var max-collateral-per-loan uint u1000000)
(define-data-var liquidation-penalty uint u5)
(define-data-var next-collateral-id uint u0)

(define-map collaterals
  {loan-id: uint, collateral-id: uint}
  {
    amount: uint,
    currency: (string-ascii 10),
    deposited-at: uint,
    depositor: principal,
    locked: bool
  }
)

(define-map loan-collateral-sums
  {loan-id: uint}
  {
    total-amount: uint,
    total-value: uint,
    num-collaterals: uint
  }
)

(define-map loan-statuses
  {loan-id: uint}
  {status: (string-ascii 20), value: uint, updated-at: uint}
)

(define-map currency-oracles
  (string-ascii 10)
  principal
)

(define-public (set-authority (new-auth principal))
  (begin
    (asserts! (is-eq tx-sender (var-get authority)) ERR-NOT-AUTHORIZED)
    (var-set authority new-auth)
    (ok true)
  )
)

(define-public (set-min-collateral-ratio (ratio uint))
  (begin
    (asserts! (is-eq tx-sender (var-get authority)) ERR-NOT-AUTHORIZED)
    (asserts! (and (> ratio u100) (<= ratio u300)) ERR-INVALID-RATIO)
    (var-set min-collateral-ratio ratio)
    (ok true)
  )
)

(define-public (set-max-collateral-per-loan (max uint))
  (begin
    (asserts! (is-eq tx-sender (var-get authority)) ERR-NOT-AUTHORIZED)
    (asserts! (> max u0) ERR-INVALID-AMOUNT)
    (var-set max-collateral-per-loan max)
    (ok true)
  )
)

(define-public (set-liquidation-penalty (penalty uint))
  (begin
    (asserts! (is-eq tx-sender (var-get authority)) ERR-NOT-AUTHORIZED)
    (asserts! (<= penalty u10) ERR-INVALID-PENALTY)
    (var-set liquidation-penalty penalty)
    (ok true)
  )
)

(define-public (set-currency-oracle (currency (string-ascii 10)) (oracle principal))
  (begin
    (asserts! (is-eq tx-sender (var-get authority)) ERR-NOT-AUTHORIZED)
    (map-set currency-oracles currency oracle)
    (ok true)
  )
)

(define-read-only (get-collateral (loan-id uint) (collateral-id uint))
  (map-get? collaterals {loan-id: loan-id, collateral-id: collateral-id})
)

(define-read-only (get-loan-collateral-sum (loan-id uint))
  (map-get? loan-collateral-sums {loan-id: loan-id})
)

(define-read-only (get-loan-status (loan-id uint))
  (map-get? loan-statuses {loan-id: loan-id})
)

(define-read-only (get-current-price (currency (string-ascii 10)) (amount uint))
  (let ((oracle (unwrap! (map-get? currency-oracles currency) (ok u0))))
    (contract-call? oracle get-price currency amount)
  )
)

(define-private (validate-amount (amount uint))
  (if (> amount u0) (ok true) ERR-ZERO-AMOUNT)
)

(define-private (validate-currency (currency (string-ascii 10)))
  (if (or (is-eq currency "STX") (is-eq currency "sBTC")) (ok true) ERR-INVALID-CURRENCY)
)

(define-private (validate-collateral-ratio (loan-id uint) (new-amount uint) (new-value uint))
  (let ((loan-sum (unwrap! (get-loan-collateral-sum loan-id) ERR-LOAN-NOT-FOUND))
        (loan-status (unwrap! (get-loan-status loan-id) ERR-LOAN-NOT-FOUND))
        (loan-value (get value loan-status))
        (total-value (+ (get total-value loan-sum) new-value))
        (ratio (* u100 (/ total-value loan-value))))
    (if (>= ratio (var-get min-collateral-ratio)) (ok true) ERR-RATIO-BELOW-THRESHOLD)
  )
)

(define-public (deposit-collateral (loan-id uint) (amount uint) (currency (string-ascii 10)))
  (let ((sender tx-sender)
        (next-id (var-get next-collateral-id))
        (current-time block-height))
    (try! (validate-amount amount))
    (try! (validate-currency currency))
    (try! (contract-call? .stx-token transfer amount tx-sender (as-contract tx-sender) none))
    (let ((price-result (try! (get-current-price currency amount)))
          (collateral-value (* amount price-result)))
      (try! (validate-collateral-ratio loan-id amount collateral-value))
      (asserts! (<= (+ next-id u1) u100) ERR-MAX-COLLATERAL-EXCEEDED)
      (map-set collaterals {loan-id: loan-id, collateral-id: next-id}
        {
          amount: amount,
          currency: currency,
          deposited-at: current-time,
          depositor: sender,
          locked: false
        }
      )
      (let ((current-sum (default-to {total-amount: u0, total-value: u0, num-collaterals: u0} (get-loan-collateral-sum loan-id))))
        (map-set loan-collateral-sums {loan-id: loan-id}
          {
            total-amount: (+ (get total-amount current-sum) amount),
            total-value: (+ (get total-value current-sum) collateral-value),
            num-collaterals: (+ (get num-collaterals current-sum) u1)
          }
        )
      )
      (var-set next-collateral-id (+ next-id u1))
      (print {event: "collateral-deposited", loan-id: loan-id, amount: amount})
      (ok next-id)
    )
  )
)

(define-public (withdraw-collateral (loan-id uint) (collateral-id uint) (amount uint))
  (let ((collateral (unwrap! (get-collateral loan-id collateral-id) ERR-INVALID-LOAN-ID))
        (sender tx-sender)
        (loan-status (unwrap! (get-loan-status loan-id) ERR-LOAN-NOT-FOUND)))
    (asserts! (is-eq sender (get depositor collateral)) ERR-NOT-AUTHORIZED)
    (asserts! (not (get locked collateral)) ERR-COLLATERAL-LOCKED)
    (asserts! (is-eq (get status loan-status) "active") ERR-INVALID-STATUS)
    (asserts! (<= amount (get amount collateral)) ERR-WITHDRAWAL-EXCEEDS)
    (let ((remaining-amount (- (get amount collateral) amount))
          (price-result (try! (get-current-price (get currency collateral) amount)))
          (withdrawal-value (* amount price-result)))
      (try! (validate-collateral-ratio loan-id (- u0 amount) (- u0 withdrawal-value)))
      (if (is-eq remaining-amount u0)
          (map-delete collaterals {loan-id: loan-id, collateral-id: collateral-id})
          (map-set collaterals {loan-id: loan-id, collateral-id: collateral-id}
            (merge collateral {amount: remaining-amount})
          )
      )
      (let ((current-sum (unwrap! (get-loan-collateral-sum loan-id) ERR-LOAN-NOT-FOUND)))
        (map-set loan-collateral-sums {loan-id: loan-id}
          {
            total-amount: (- (get total-amount current-sum) amount),
            total-value: (- (get total-value current-sum) withdrawal-value),
            num-collaterals: (if (is-eq remaining-amount u0) (- (get num-collaterals current-sum) u1) (get num-collaterals current-sum))
          }
        )
      )
      (as-contract (contract-call? .stx-token transfer amount (as-contract tx-sender) sender none))
      (print {event: "collateral-withdrawn", loan-id: loan-id, amount: amount})
      (ok true)
    )
  )
)

(define-public (lock-collateral (loan-id uint) (collateral-id uint))
  (let ((collateral (unwrap! (get-collateral loan-id collateral-id) ERR-INVALID-LOAN-ID))
        (sender tx-sender))
    (asserts! (is-eq sender (var-get authority)) ERR-NOT-AUTHORIZED)
    (map-set collaterals {loan-id: loan-id, collateral-id: collateral-id}
      (merge collateral {locked: true})
    )
    (print {event: "collateral-locked", loan-id: loan-id, collateral-id: collateral-id})
    (ok true)
  )
)

(define-public (unlock-collateral (loan-id uint) (collateral-id uint))
  (let ((collateral (unwrap! (get-collateral loan-id collateral-id) ERR-INVALID-LOAN-ID))
        (sender tx-sender))
    (asserts! (is-eq sender (var-get authority)) ERR-NOT-AUTHORIZED)
    (map-set collaterals {loan-id: loan-id, collateral-id: collateral-id}
      (merge collateral {locked: false})
    )
    (print {event: "collateral-unlocked", loan-id: loan-id, collateral-id: collateral-id})
    (ok true)
  )
)

(define-public (update-loan-status (loan-id uint) (new-status (string-ascii 20)) (value uint))
  (begin
    (asserts! (is-eq tx-sender (var-get authority)) ERR-NOT-AUTHORIZED)
    (map-set loan-statuses {loan-id: loan-id}
      {status: new-status, value: value, updated-at: block-height}
    )
    (print {event: "loan-status-updated", loan-id: loan-id, status: new-status})
    (ok true)
  )
)

(define-public (liquidate-collateral (loan-id uint))
  (let ((loan-status (unwrap! (get-loan-status loan-id) ERR-LOAN-NOT-FOUND))
        (loan-sum (unwrap! (get-loan-collateral-sum loan-id) ERR-INSUFFICIENT-COLLATERAL))
        (sender tx-sender))
    (asserts! (is-eq sender (var-get authority)) ERR-NOT-AUTHORIZED)
    (asserts! (is-eq (get status loan-status) "defaulted") ERR-INVALID-STATUS)
    (let ((total-amount (get total-amount loan-sum))
          (total-value (get total-value loan-sum))
          (penalty-amount (* total-value (/ (var-get liquidation-penalty) u100))))
      (asserts! (> total-amount u0) ERR-INSUFFICIENT-COLLATERAL)
      (as-contract (contract-call? .stx-token transfer total-amount (as-contract tx-sender) .lending-pool none))
      (map-set loan-collateral-sums {loan-id: loan-id}
        {total-amount: u0, total-value: u0, num-collaterals: u0}
      )
      (map-delete loan-statuses {loan-id: loan-id})
      (print {event: "collateral-liquidated", loan-id: loan-id, amount: total-amount, penalty: penalty-amount})
      (ok total-amount)
    )
  )
)

(define-read-only (is-over-collateralized (loan-id uint))
  (let ((loan-sum (unwrap! (get-loan-collateral-sum loan-id) (ok false)))
        (loan-status (unwrap! (get-loan-status loan-id) (ok false)))
        (ratio (* u100 (/ (get total-value loan-sum) (get value loan-status)))))
    (ok (>= ratio (var-get min-collateral-ratio)))
  )
)