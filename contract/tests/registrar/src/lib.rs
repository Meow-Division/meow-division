// contract/tests/registrar/src/lib.rs — a stand-in for mainnet's `near` account in the items contract's sandbox
// tests. Mainnet's registrar runs near-linkdrop at commit 9a6bb316 (its NEP-330 `contract_source_metadata` says so);
// `create_account` and `on_account_created` here are that code, so `game_wallet` is tested against what the
// registrar really does: create the account, add the key as full access, pass the deposit on, and on failure send the
// deposit back to the caller and answer false. The tests deploy it on `registrar.sandbox`, which may create
// `<name>.registrar.sandbox` as `near` creates `<name>.near`.

use near_sdk::utils::is_promise_success;
use near_sdk::{AccountId, Gas, NearToken, Promise, PublicKey, env, near};

pub const ON_CREATE_ACCOUNT_CALLBACK_GAS: Gas = Gas::from_tgas(13);

#[near(contract_state)]
#[derive(Default)]
pub struct Registrar {}

#[near]
impl Registrar {
    #[payable]
    pub fn create_account(
        &mut self,
        new_account_id: AccountId,
        new_public_key: PublicKey,
    ) -> Promise {
        let amount = env::attached_deposit();
        Promise::new(new_account_id)
            .create_account()
            .add_full_access_key(new_public_key)
            .transfer(amount)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(ON_CREATE_ACCOUNT_CALLBACK_GAS)
                    .on_account_created(env::predecessor_account_id(), amount),
            )
    }

    #[private]
    pub fn on_account_created(
        &mut self,
        predecessor_account_id: AccountId,
        amount: NearToken,
    ) -> bool {
        let creation_succeeded = is_promise_success();
        if !creation_succeeded {
            // In case of failure, send funds back.
            Promise::new(predecessor_account_id)
                .transfer(amount)
                .detach();
        }
        creation_succeeded
    }
}
