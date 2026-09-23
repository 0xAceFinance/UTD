#!/usr/bin/env python3
"""Settle every Active-on-chain duel that the backend API already has a
ready oracle signature for.

WHAT THIS DOES AND DOESN'T DO
------------------------------
This script does NOT decide who won a duel. It never touches the oracle
signer key or re-runs any market-cap logic. It only plays the same role as
`lib/settlementRelayer.ts` / the `/api/cron/settle` keeper described in the
project's README: `BattleEscrow.settle()` is permissionless on purpose --
anyone holding a validly signed result can submit it -- so this script pays
gas from YOUR wallet to relay settlements the backend has already computed
and signed. If a duel hasn't been signed yet (still LIVE, endTime not yet
reached, or flagged HELD for a sybil review), this script hits the same
public `GET /api/duels/{id}` endpoint the app itself polls to trigger that
signing (self-heals/settles like a normal page view would), then relays
whatever comes out of it. A HELD duel is skipped and reported -- it needs a
human via `/api/admin/duels/{id}/resolve`, not a relayer key.

SAFETY
------
- Your private key is read once via a hidden prompt (getpass), used only
  in-memory to sign transactions locally, and never written to disk, logged,
  or sent anywhere. Nothing in this script ever transmits it over the
  network.
- Use a wallet holding only what you're willing to spend on gas. This
  script never needs to be the oracle signer or hold duel stakes.
- Safe to run alongside the real cron: if another submitter (the cron, or
  another run of this script) settles a duel first, this script's own
  attempt will simply revert (status no longer Active) -- caught and
  reported as a skip, not a double payout.
- Defaults to a confirmation prompt before sending any real transaction;
  pass --yes to skip it (e.g. for a cron job of your own) and --dry-run to
  only print what would happen.

USAGE
-----
    pip install -r requirements.txt
    python3 settle_active_duels.py --api-base https://your-app-domain

Run with --help for every flag.
"""
from __future__ import annotations

import argparse
import getpass
import sys
import time
from typing import Any

import requests
from eth_account import Account
from web3 import Web3

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

# Only the one function this script ever calls -- see FE/abis/BattleEscrow.json
# for the full ABI. Keeping just this entry means the script has nothing to
# get out of sync with if the contract gains unrelated functions later.
SETTLE_ABI = [
    {
        "type": "function",
        "name": "settle",
        "inputs": [
            {"name": "_winnerSide", "type": "uint8"},
            {"name": "_referrerA", "type": "address"},
            {"name": "_referrerABps", "type": "uint256"},
            {"name": "_referrerB", "type": "address"},
            {"name": "_referrerBBps", "type": "uint256"},
            {"name": "signature", "type": "bytes"},
        ],
        "outputs": [],
        "stateMutability": "nonpayable",
    }
]

DEFAULT_RPC_URL = "https://rpc.mainnet.chain.robinhood.com"
DEFAULT_CHAIN_ID = 4663


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument(
        "--api-base",
        required=True,
        help="Base URL of the backend API, e.g. https://your-app.vercel.app or the Cloud Run service URL directly. "
        "No trailing slash.",
    )
    p.add_argument("--rpc-url", default=DEFAULT_RPC_URL, help=f"Chain RPC URL (default: {DEFAULT_RPC_URL})")
    p.add_argument("--chain-id", type=int, default=DEFAULT_CHAIN_ID, help=f"Chain ID (default: {DEFAULT_CHAIN_ID})")
    p.add_argument(
        "--gas-price-gwei",
        type=float,
        default=None,
        help="Override gas price in gwei. Default: ask the RPC node for its current suggested price.",
    )
    p.add_argument(
        "--dry-run", action="store_true", help="Print what would be settled without sending any transaction."
    )
    p.add_argument("--yes", action="store_true", help="Skip the confirmation prompt before sending real transactions.")
    p.add_argument(
        "--skip-confirm",
        action="store_true",
        help="Don't POST /api/duels/{id}/confirm-settlement after a successful tx (points/referrals won't be "
        "credited until something else confirms it -- the cron will still pick it up later).",
    )
    return p.parse_args()


def api_get(api_base: str, path: str) -> Any:
    resp = requests.get(f"{api_base}{path}", timeout=20)
    resp.raise_for_status()
    body = resp.json()
    if not body.get("success"):
        raise RuntimeError(f"GET {path} failed: {body.get('error')}")
    return body["data"]


def api_post(api_base: str, path: str, payload: dict) -> Any:
    resp = requests.post(f"{api_base}{path}", json=payload, timeout=20)
    resp.raise_for_status()
    body = resp.json()
    if not body.get("success"):
        raise RuntimeError(f"POST {path} failed: {body.get('error')}")
    return body["data"]


def collect_settleable_duels(api_base: str) -> list[dict]:
    """Every duel that either already has a ready signature, or can get one
    by hitting the same self-healing tick the app's own UI polls."""
    live = api_get(api_base, "/api/duels?status=LIVE")
    settling = api_get(api_base, "/api/duels?status=SETTLING")

    settleable: dict[str, dict] = {d["_id"]: d for d in settling}
    held_count = 0

    for duel in live:
        if not duel.get("escrowAddress"):
            continue  # legacy off-chain duel, nothing to settle on-chain
        # Same tick the frontend runs every ~3s while LIVE (README: "Live" step) --
        # a no-op if endTime hasn't passed yet, signs it into SETTLING if it has.
        ticked = api_get(api_base, f"/api/duels/{duel['_id']}")
        if ticked.get("status") == "SETTLING" and ticked.get("oracleSignature"):
            settleable[ticked["_id"]] = ticked
        elif ticked.get("status") == "HELD":
            held_count += 1

    if held_count:
        print(
            f"Skipping {held_count} duel(s) flagged HELD for sybil review -- "
            "resolve those via POST /api/admin/duels/{id}/resolve, not this script.",
            file=sys.stderr,
        )

    return [d for d in settleable.values() if d.get("escrowAddress") and d.get("oracleSignature")]


def build_settle_tx(w3: Web3, duel: dict, overrides: dict) -> dict:
    """`overrides` must include from/chainId/nonce/gasPrice but deliberately
    NOT 'gas' -- leaving it out is what makes web3 auto-fill it with a real
    eth_estimateGas call against the live contract/calldata, which we then
    pad with a buffer in main() rather than trusting the estimate exactly."""
    contract = w3.eth.contract(address=Web3.to_checksum_address(duel["escrowAddress"]), abi=SETTLE_ABI)
    winner_side = int(duel["winnerSide"])
    referrer_a = duel.get("creatorReferrerWallet") or ZERO_ADDRESS
    referrer_a_bps = int(duel.get("creatorReferrerBps") or 0)
    referrer_b = duel.get("opponentReferrerWallet") or ZERO_ADDRESS
    referrer_b_bps = int(duel.get("opponentReferrerBps") or 0)
    signature = duel["oracleSignature"]
    return contract.functions.settle(
        winner_side,
        Web3.to_checksum_address(referrer_a),
        referrer_a_bps,
        Web3.to_checksum_address(referrer_b),
        referrer_b_bps,
        signature,
    ).build_transaction(overrides)


def main() -> None:
    args = parse_args()
    api_base = args.api_base.rstrip("/")

    private_key = getpass.getpass("Private key (input hidden, never stored or sent anywhere): ").strip()
    if not private_key:
        print("No private key entered, aborting.", file=sys.stderr)
        sys.exit(1)
    if not private_key.startswith("0x"):
        private_key = "0x" + private_key

    account = Account.from_key(private_key)
    private_key = None  # nothing below needs the raw key again; account.sign_transaction still works
    print(f"Relaying as: {account.address}")

    w3 = Web3(Web3.HTTPProvider(args.rpc_url))
    if not w3.is_connected():
        print(f"Could not reach RPC {args.rpc_url}", file=sys.stderr)
        sys.exit(1)

    balance = w3.eth.get_balance(account.address)
    print(f"Wallet balance: {w3.from_wei(balance, 'ether')} ETH (for gas)")

    print(f"Fetching duels from {api_base} ...")
    duels = collect_settleable_duels(api_base)
    if not duels:
        print("Nothing to settle -- no LIVE duel is past endTime with a ready signature, and none already SETTLING.")
        return

    print(f"\n{len(duels)} duel(s) ready to settle:")
    for d in duels:
        print(f"  {d['_id']}  escrow={d['escrowAddress']}  winnerSide={d['winnerSide']}")

    if args.dry_run:
        print("\n--dry-run: not sending any transaction.")
        return

    if not args.yes:
        confirm = input(f"\nSend {len(duels)} settle() transaction(s) from {account.address}? [y/N] ")
        if confirm.strip().lower() != "y":
            print("Aborted.")
            return

    gas_price = w3.to_wei(args.gas_price_gwei, "gwei") if args.gas_price_gwei is not None else w3.eth.gas_price
    nonce = w3.eth.get_transaction_count(account.address)

    settled, skipped, failed = 0, 0, 0
    for d in duels:
        try:
            tx = build_settle_tx(
                w3,
                d,
                {
                    "from": account.address,
                    "chainId": args.chain_id,
                    "nonce": nonce,
                    "gasPrice": gas_price,
                },
            )
            tx["gas"] = int(tx["gas"] * 1.2)  # pad web3's own estimate by 20%

            signed = account.sign_transaction(tx)
            tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
            print(f"  {d['_id']}: sent {tx_hash.hex()}, waiting for receipt ...")
            receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=180)
            nonce += 1

            if receipt.status != 1:
                print(f"  {d['_id']}: transaction reverted on-chain")
                failed += 1
                continue

            settled += 1
            print(f"  {d['_id']}: settled (block {receipt.blockNumber})")

            if not args.skip_confirm:
                try:
                    api_post(api_base, f"/api/duels/{d['_id']}/confirm-settlement", {"txHash": tx_hash.hex()})
                    print(f"  {d['_id']}: confirmed with backend (points/referrals credited)")
                except Exception as e:  # noqa: BLE001 -- best-effort, cron will retry
                    print(f"  {d['_id']}: settled on-chain but confirm-settlement call failed ({e}); "
                          "the cron will pick this up later")
        except Exception as e:  # noqa: BLE001 -- one bad duel shouldn't stop the batch
            msg = str(e)
            if "Active" in msg or "revert" in msg.lower():
                print(f"  {d['_id']}: skipped -- likely already settled by something else ({msg})")
                skipped += 1
            else:
                print(f"  {d['_id']}: FAILED -- {msg}")
                failed += 1
            # A reverted/failed tx still consumed this nonce on-chain (or wasn't sent
            # at all if estimate_gas raised before broadcast); only bump nonce for the
            # former. Re-reading it from the chain keeps this correct either way.
            nonce = w3.eth.get_transaction_count(account.address)
        time.sleep(1)  # be polite to the RPC/API between duels

    print(f"\nDone. settled={settled} skipped={skipped} failed={failed}")


if __name__ == "__main__":
    main()
