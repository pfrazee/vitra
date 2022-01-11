# Vitra API Reference

This site is the API reference for [Vitra](https://github.com/pfrazee/vitra). You can find more detailed documentation, including the whitepaper, specs, and CLI usage, in [the git repository](https://github.com/pfrazee/vitra).

## Quick reference

- [`Database`](/classes/Database.html). The main API for using Vitra.
  - [`Database.create()`](/classes/Database.html#create). Create a new Vitra database.
  - [`Database.load()`](/classes/Database.html#load). Load an existing Vitra database.
  - [`database#call`](/classes/Database.html#call). Execute a transaction the database.

#### Common

- [`Transaction`](/classes/Transaction.html). The class returned by [`database#call`](/classes/Database.html#call).
- [`Operation`](/classes/Operation.html). Individual operations included in a `Transaction`.
- [`OpLog`](/classes/OpLog.html). The API for participant operation logs.
- [`IndexLog`](/classes/IndexLog.html). The API for the output index log.

#### Proofs

- [`BlockInclusionProof`](/classes/BlockInclusionProof.html)
- [`BlockRewriteFraudProof`](/classes/BlockRewriteFraudProof.html)
- [`ContractFraudProof`](/classes/ContractFraudProof.html)
- [`LogForkFraudProof`](/classes/LogForkFraudProof.html)