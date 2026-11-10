// contract/src/wallet.rs — a wallet made inside the game. The player picks a name; the page makes the key pair from a
// new recovery phrase (the private key never leaves the player's device); the game server asks this contract to
// create `<name>.near` with that public key as its full-access key. The contract calls the mainnet registrar `near`
// (its payable `create_account`, the same one wallets use) and pays a small deposit from its own balance, so the
// player needs no NEAR to start. Only the game signer calls it, at most `wallets_left` more times (the owner sets the
// cap and the deposit), and a request id is applied once. When the registrar fails (the name was taken meanwhile),
// the callback gives the place back and frees the request id; the registrar returns the deposit itself.
//
// The settings sit under their own storage key, apart from the contract's struct, so the state written by the
// version before this one (0.1.0, deployed 2026-11-09) reads as it is: `migrate` changes no layout.

use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{
    AccountId, Gas, NearToken, Promise, PromiseError, PromiseOrValue, PublicKey, env, near, require,
};

use crate::events::{GameEvent, WalletLog};
use crate::{Contract, ContractExt, check_id};

/// Where the wallet settings live (outside the contract's struct, see the header).
const WALLETS_KEY: &[u8] = b"wallets";
/// The mainnet registrar: `<name>.near` accounts are made through its `create_account`.
pub const REGISTRAR: &str = "near";
/// What a new wallet starts with: its own storage (about 182 bytes, 0.00182 NEAR) and a few transactions of gas.
pub const WALLET_DEPOSIT: NearToken = NearToken::from_millinear(10);
/// The owner's deposit setting must stay between these: below, the new account cannot pay its own storage and the
/// registrar refuses it; above, a typo would hand out the contract's balance.
pub const MIN_WALLET_DEPOSIT: NearToken = NearToken::from_micronear(2000);
pub const MAX_WALLET_DEPOSIT: NearToken = NearToken::from_millinear(100);
/// Gas for the registrar's `create_account`: its own run, the account's creation and its 13 Tgas callback.
pub const REGISTRAR_GAS: Gas = Gas::from_tgas(30);
/// Gas for `on_wallet`, which reads the registrar's answer.
pub const CALLBACK_GAS: Gas = Gas::from_tgas(10);

/// The wallet settings and counts. The cap starts at 0: nothing leaves the contract's balance for wallets until the
/// owner has set how many and how much (`set_wallets`).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Wallets {
    pub registrar_id: AccountId,
    pub wallets_left: u32,
    pub wallet_deposit: U128,
    pub wallets_made: u32,
}

impl Default for Wallets {
    fn default() -> Self {
        Self {
            registrar_id: REGISTRAR.parse().unwrap_or_else(|_| env::abort()),
            wallets_left: 0,
            wallet_deposit: U128(WALLET_DEPOSIT.as_yoctonear()),
            wallets_made: 0,
        }
    }
}

fn read() -> Wallets {
    env::storage_read(WALLETS_KEY)
        .map(|raw| {
            near_sdk::borsh::from_slice(&raw)
                .unwrap_or_else(|_| env::panic_str("bad wallet settings"))
        })
        .unwrap_or_default()
}

fn write(w: &Wallets) {
    let raw = near_sdk::borsh::to_vec(w).unwrap_or_else(|_| env::abort());
    env::storage_write(WALLETS_KEY, &raw);
}

fn op_key(request_id: &str) -> String {
    format!("wallet:{request_id}")
}

#[near]
impl Contract {
    /// Creates `account_id` (a name right under the registrar: `<name>.near` on mainnet) with `public_key` as its
    /// full-access key, the registrar paid `wallet_deposit` from this contract's balance. Resolves to true once the
    /// account exists; false when the registrar refused (the name is taken) or `request_id` was applied before.
    pub fn game_wallet(
        &mut self,
        account_id: AccountId,
        public_key: PublicKey,
        request_id: String,
    ) -> PromiseOrValue<bool> {
        self.assert_game_signer();
        check_id(&request_id, "request id");
        let mut w = read();
        require!(
            account_id.is_sub_account_of(&w.registrar_id),
            "a wallet is a name right under the registrar"
        );
        if !self.record_op(op_key(&request_id)) {
            return PromiseOrValue::Value(false);
        }
        require!(w.wallets_left > 0, "no wallets left");
        w.wallets_left -= 1;
        write(&w);
        let deposit = NearToken::from_yoctonear(w.wallet_deposit.0);
        self.assert_reserve_after(deposit);
        let args = json!({ "new_account_id": account_id, "new_public_key": public_key });
        Promise::new(w.registrar_id)
            .function_call(
                "create_account".to_string(),
                args.to_string().into_bytes(),
                deposit,
                REGISTRAR_GAS,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_wallet(account_id, request_id),
            )
            .into()
    }

    /// The registrar's answer: its `create_account` resolves to true when the account was made. Anything else gives
    /// the cap its place back and frees the request id, so the same request can be tried again.
    #[private]
    pub fn on_wallet(
        &mut self,
        account_id: AccountId,
        request_id: String,
        #[callback_result] made: Result<bool, PromiseError>,
    ) -> bool {
        let mut w = read();
        if matches!(made, Ok(true)) {
            w.wallets_made = w.wallets_made.saturating_add(1);
            write(&w);
            GameEvent::WalletCreate(WalletLog {
                account_id,
                request_id,
            })
            .emit();
            return true;
        }
        w.wallets_left = w.wallets_left.saturating_add(1);
        write(&w);
        self.ops.remove(&op_key(&request_id));
        false
    }

    /// How many more wallets the game may make and what each one starts with (owner, 1 yoctoNEAR). `registrar_id`
    /// moves the registrar (the sandbox tests use a stand-in); left out, it stays.
    #[payable]
    pub fn set_wallets(
        &mut self,
        wallets_left: u32,
        wallet_deposit: U128,
        registrar_id: Option<AccountId>,
    ) {
        self.assert_owner();
        require!(
            wallet_deposit.0 >= MIN_WALLET_DEPOSIT.as_yoctonear()
                && wallet_deposit.0 <= MAX_WALLET_DEPOSIT.as_yoctonear(),
            "the wallet deposit is between 0.002 and 0.1 NEAR"
        );
        let mut w = read();
        w.wallets_left = wallets_left;
        w.wallet_deposit = wallet_deposit;
        if let Some(id) = registrar_id {
            w.registrar_id = id;
        }
        write(&w);
        self.assert_reserve();
    }

    pub fn wallets(&self) -> Wallets {
        read()
    }
}
