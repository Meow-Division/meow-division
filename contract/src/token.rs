// contract/src/token.rs — balances and the NEP-245 core: transfers (1 yoctoNEAR, so only a full-access key can
// move items to any account; the sender pays a new receiver's record), transfer-and-call with refunds, and the
// balance and supply views. Every change goes through `mint`, `burn` or `move_tokens`, which keep supply in step and
// emit the NEP-297 event.

use near_sdk::json_types::U128;
use near_sdk::serde_json;
use near_sdk::{
    AccountId, Gas, NearToken, Promise, PromiseOrValue, env, ext_contract, near, require,
};

use crate::events::{MtBurnLog, MtEvent, MtMintLog, MtTransferLog, to_json};
use crate::metadata::Token;
use crate::{Contract, ContractExt, Holdings, TokenId, check_batch};

/// Gas kept back for `mt_resolve_transfer`; the receiver gets the rest of what the caller attached.
const GAS_FOR_RESOLVE_TRANSFER: Gas = Gas::from_tgas(15);
/// Least gas a transfer-and-call must bring: this call, the receiver's minimum and the resolve.
const GAS_FOR_TRANSFER_CALL: Gas = Gas::from_tgas(30);
/// A receiver's answer longer than this is treated as a failure (it should be a short list of numbers).
const MAX_RESULT_LEN: usize = 4096;

// The macro builds `ext_mt_receiver` from this trait; the trait itself is never implemented here.
#[allow(dead_code)]
#[ext_contract(ext_mt_receiver)]
pub trait MtReceiver {
    fn mt_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>>;
}

/// This contract has no approval management: an approval argument must be absent.
fn require_no_approvals<T>(approvals: &Option<T>) {
    require!(approvals.is_none(), "approvals are not supported");
}

/// The least a standard transfer attaches (NEP-245): a function-call key can attach nothing, so it can't move items.
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

impl Contract {
    pub(crate) fn balance(&self, account_id: &AccountId, token_id: &str) -> u128 {
        self.accounts
            .get(account_id)
            .and_then(|h| h.get(token_id).copied())
            .unwrap_or(0)
    }

    fn holdings(&self, account_id: &AccountId) -> Holdings {
        self.accounts.get(account_id).cloned().unwrap_or_default()
    }

    fn store_holdings(&mut self, account_id: &AccountId, holdings: Holdings) {
        if holdings.is_empty() {
            self.accounts.remove(account_id);
        } else {
            self.accounts.insert(account_id.clone(), holdings);
        }
    }

    fn add_to(&mut self, account_id: &AccountId, token_ids: &[TokenId], amounts: &[u128]) {
        let mut held = self.holdings(account_id);
        for (id, &amount) in token_ids.iter().zip(amounts) {
            let entry = held.entry(id.clone()).or_insert(0);
            *entry = entry
                .checked_add(amount)
                .unwrap_or_else(|| env::panic_str("balance overflow"));
        }
        self.store_holdings(account_id, held);
    }

    fn take_from(&mut self, account_id: &AccountId, token_ids: &[TokenId], amounts: &[u128]) {
        let mut held = self.holdings(account_id);
        for (id, &amount) in token_ids.iter().zip(amounts) {
            let have = held.get(id).copied().unwrap_or(0);
            let left = have
                .checked_sub(amount)
                .unwrap_or_else(|| env::panic_str(&format!("not enough {id}")));
            if left == 0 {
                held.remove(id);
            } else {
                held.insert(id.clone(), left);
            }
        }
        self.store_holdings(account_id, held);
    }

    fn change_supply(&mut self, token_ids: &[TokenId], amounts: &[u128], up: bool) {
        for (id, &amount) in token_ids.iter().zip(amounts) {
            let record = self
                .tokens
                .get_mut(id)
                .unwrap_or_else(|| env::panic_str(&format!("unknown token {id}")));
            record.supply = if up {
                record.supply.checked_add(amount)
            } else {
                record.supply.checked_sub(amount)
            }
            .unwrap_or_else(|| env::panic_str("supply out of range"));
        }
    }

    pub(crate) fn mint(
        &mut self,
        owner_id: &AccountId,
        token_ids: &[TokenId],
        amounts: &[u128],
        memo: Option<String>,
    ) {
        self.change_supply(token_ids, amounts, true);
        self.add_to(owner_id, token_ids, amounts);
        MtEvent::MtMint(vec![MtMintLog {
            owner_id: owner_id.clone(),
            token_ids: token_ids.to_vec(),
            amounts: to_json(amounts),
            memo,
        }])
        .emit();
    }

    pub(crate) fn burn(
        &mut self,
        owner_id: &AccountId,
        token_ids: &[TokenId],
        amounts: &[u128],
        authorized_id: Option<AccountId>,
        memo: Option<String>,
    ) {
        self.take_from(owner_id, token_ids, amounts);
        self.change_supply(token_ids, amounts, false);
        MtEvent::MtBurn(vec![MtBurnLog {
            owner_id: owner_id.clone(),
            authorized_id,
            token_ids: token_ids.to_vec(),
            amounts: to_json(amounts),
            memo,
        }])
        .emit();
    }

    pub(crate) fn move_tokens(
        &mut self,
        from: &AccountId,
        to: &AccountId,
        token_ids: &[TokenId],
        amounts: &[u128],
        authorized_id: Option<AccountId>,
        memo: Option<String>,
    ) {
        require!(from != to, "sender and receiver are the same account");
        for id in token_ids {
            require!(self.tokens.contains_key(id), format!("unknown token {id}"));
        }
        self.take_from(from, token_ids, amounts);
        self.add_to(to, token_ids, amounts);
        MtEvent::MtTransfer(vec![MtTransferLog {
            authorized_id,
            old_owner_id: from.clone(),
            new_owner_id: to.clone(),
            token_ids: token_ids.to_vec(),
            amounts: to_json(amounts),
            memo,
        }])
        .emit();
    }

    /// A standard transfer from the caller: at least 1 yoctoNEAR attached (NEP-245), and when the receiver holds nothing
    /// here yet, the storage its new holdings record takes on top. The contract pays storage for what the game mints,
    /// not for records a holder makes by scattering items over new accounts; a holder's record only gains an entry
    /// per token id (a few dozen at most), which the contract keeps paying, so a transfer between players who hold
    /// items needs the usual 1 yoctoNEAR. What the deposit has beyond what is due goes back to the sender.
    fn paid_transfer(
        &mut self,
        receiver_id: &AccountId,
        token_ids: &[TokenId],
        amounts: &[u128],
        memo: Option<String>,
    ) {
        let deposit = env::attached_deposit();
        require!(
            deposit >= ONE_YOCTO,
            "Requires attached deposit of at least 1 yoctoNEAR"
        );
        let sender_id = env::predecessor_account_id();
        let new_record = !self.accounts.contains_key(receiver_id);
        self.accounts.flush();
        let before = env::storage_usage();
        self.move_tokens(&sender_id, receiver_id, token_ids, amounts, None, memo);
        self.accounts.flush();
        let added = if new_record {
            env::storage_usage().saturating_sub(before)
        } else {
            0
        };
        let due = env::storage_byte_cost()
            .saturating_mul(u128::from(added))
            .saturating_add(ONE_YOCTO);
        require!(
            deposit >= due,
            format!(
                "the receiver holds nothing here yet: attach {} yoctoNEAR for its storage",
                due.as_yoctonear()
            )
        );
        let back = deposit.saturating_sub(due);
        if !back.is_zero() {
            Promise::new(sender_id).transfer(back).detach();
        }
        self.assert_reserve();
    }

    fn transfer_and_call(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<TokenId>,
        amounts: Vec<u128>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        require!(
            env::prepaid_gas() > GAS_FOR_TRANSFER_CALL,
            "attach more gas: at least 30 Tgas"
        );
        let sender_id = env::predecessor_account_id();
        self.paid_transfer(&receiver_id, &token_ids, &amounts, memo);
        let previous_owner_ids = vec![sender_id.clone(); token_ids.len()];
        let amounts = to_json(&amounts);
        ext_mt_receiver::ext(receiver_id.clone())
            .with_unused_gas_weight(1)
            .mt_on_transfer(
                sender_id,
                previous_owner_ids.clone(),
                token_ids.clone(),
                amounts.clone(),
                msg,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_RESOLVE_TRANSFER)
                    .with_unused_gas_weight(0)
                    .mt_resolve_transfer(previous_owner_ids, receiver_id, token_ids, amounts),
            )
            .into()
    }
}

#[near]
impl Contract {
    #[payable]
    pub fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
    ) {
        require_no_approvals(&approval);
        let amounts = check_batch(std::slice::from_ref(&token_id), &[amount]);
        self.paid_transfer(&receiver_id, &[token_id], &amounts, memo);
    }

    #[payable]
    pub fn mt_batch_transfer(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
    ) {
        require_no_approvals(&approvals);
        let amounts = check_batch(&token_ids, &amounts);
        self.paid_transfer(&receiver_id, &token_ids, &amounts, memo);
    }

    #[payable]
    pub fn mt_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        require_no_approvals(&approval);
        let amounts = check_batch(std::slice::from_ref(&token_id), &[amount]);
        self.transfer_and_call(receiver_id, vec![token_id], amounts, memo, msg)
    }

    #[payable]
    pub fn mt_batch_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        require_no_approvals(&approvals);
        let amounts = check_batch(&token_ids, &amounts);
        self.transfer_and_call(receiver_id, token_ids, amounts, memo, msg)
    }

    /// Ends a transfer-and-call: whatever the receiver reports unused (all of it if the call failed) goes back
    /// to the sender, as far as the receiver still holds it. Returns the amounts the receiver kept.
    #[private]
    pub fn mt_resolve_transfer(
        &mut self,
        previous_owner_ids: Vec<AccountId>,
        receiver_id: AccountId,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
    ) -> Vec<U128> {
        let sent: Vec<u128> = amounts.iter().map(|a| a.0).collect();
        let unused: Vec<u128> = match env::promise_result_checked(0, MAX_RESULT_LEN) {
            Ok(bytes) => serde_json::from_slice::<Vec<U128>>(&bytes)
                .ok()
                .filter(|u| u.len() == sent.len())
                .map(|u| u.iter().zip(&sent).map(|(u, s)| u.0.min(*s)).collect())
                .unwrap_or_else(|| sent.clone()),
            Err(_) => sent.clone(),
        };
        let mut kept = Vec::with_capacity(sent.len());
        for (i, token_id) in token_ids.iter().enumerate() {
            let refund = unused[i].min(self.balance(&receiver_id, token_id));
            if refund > 0 {
                let owner = &previous_owner_ids[i];
                self.move_tokens(
                    &receiver_id,
                    owner,
                    std::slice::from_ref(token_id),
                    &[refund],
                    None,
                    Some("refund".into()),
                );
            }
            kept.push(U128(sent[i] - refund));
        }
        kept
    }

    pub fn mt_token(&self, token_ids: Vec<TokenId>) -> Vec<Option<Token>> {
        token_ids
            .into_iter()
            .map(|id| {
                self.tokens.contains_key(&id).then_some(Token {
                    token_id: id,
                    owner_id: None,
                })
            })
            .collect()
    }

    pub fn mt_balance_of(&self, account_id: AccountId, token_id: TokenId) -> U128 {
        U128(self.balance(&account_id, &token_id))
    }

    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<TokenId>) -> Vec<U128> {
        token_ids
            .iter()
            .map(|id| U128(self.balance(&account_id, id)))
            .collect()
    }

    pub fn mt_supply(&self, token_id: TokenId) -> Option<U128> {
        self.tokens.get(&token_id).map(|t| U128(t.supply))
    }

    pub fn mt_batch_supply(&self, token_ids: Vec<TokenId>) -> Vec<Option<U128>> {
        token_ids
            .iter()
            .map(|id| self.tokens.get(id).map(|t| U128(t.supply)))
            .collect()
    }
}
