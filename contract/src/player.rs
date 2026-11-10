// contract/src/player.rs — what a player does with their own items without a wallet window: craft a kit from
// materials, spend materials on something off-chain (a building level, a barter), wear a skin. No deposit, so
// the calls run behind the function-call key the player approved once at connect. Each can only burn the
// caller's own items or change the caller's own skin.

use near_sdk::json_types::U128;
use near_sdk::{env, near, require};

use crate::events::{EquipLog, GameEvent};
use crate::{Contract, ContractExt, TokenId, check_batch, check_id};

/// Most times one recipe can be crafted in one call.
const MAX_CRAFT_TIMES: u32 = 20;

#[near]
impl Contract {
    /// Burns the recipe's inputs and mints its outputs, `times` over (default 1). Returns false if this request
    /// id was already used by the caller.
    pub fn craft(&mut self, recipe_id: String, times: Option<u32>, request_id: String) -> bool {
        let crafter = env::predecessor_account_id();
        check_id(&request_id, "request id");
        let times = times.unwrap_or(1);
        require!((1..=MAX_CRAFT_TIMES).contains(&times), "times is 1 to 20");
        let recipe = self
            .recipes
            .get(&recipe_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("no such recipe"));
        if !self.record_player_op("craft", &crafter, &request_id) {
            return false;
        }
        let scale = |parts: &[crate::Part]| -> (Vec<TokenId>, Vec<u128>) {
            let ids = parts.iter().map(|p| p.token_id.clone()).collect();
            let amounts = parts
                .iter()
                .map(|p| {
                    p.amount
                        .0
                        .checked_mul(u128::from(times))
                        .unwrap_or_else(|| env::panic_str("amount overflow"))
                })
                .collect();
            (ids, amounts)
        };
        let (in_ids, in_amounts) = scale(&recipe.inputs);
        let (out_ids, out_amounts) = scale(&recipe.outputs);
        let memo = Some(format!("craft:{recipe_id}"));
        self.burn(&crafter, &in_ids, &in_amounts, None, memo.clone());
        self.mint(&crafter, &out_ids, &out_amounts, memo);
        self.assert_reserve();
        true
    }

    /// Burns the caller's items for an off-chain purpose the server reads from the event memo
    /// (`purpose` such as "build:workbench:2" or "barter:minigun"). Returns false on a repeated request id.
    pub fn spend(
        &mut self,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
        purpose: String,
        request_id: String,
    ) -> bool {
        let owner = env::predecessor_account_id();
        check_id(&purpose, "purpose");
        check_id(&request_id, "request id");
        let amounts = check_batch(&token_ids, &amounts);
        if !self.record_player_op("spend", &owner, &request_id) {
            return false;
        }
        self.burn(
            &owner,
            &token_ids,
            &amounts,
            None,
            Some(format!("spend:{purpose}:{request_id}")),
        );
        self.assert_reserve();
        true
    }

    /// Wears a skin the caller holds (token ids starting with `s_`), or none.
    pub fn equip(&mut self, token_id: Option<TokenId>) {
        let account_id = env::predecessor_account_id();
        match &token_id {
            Some(id) => {
                require!(id.starts_with("s_"), "only skins can be worn");
                require!(
                    self.balance(&account_id, id) > 0,
                    "you do not have this skin"
                );
                self.equipped.insert(account_id.clone(), id.clone());
            }
            None => {
                self.equipped.remove(&account_id);
            }
        }
        GameEvent::Equip(EquipLog {
            account_id,
            token_id,
        })
        .emit();
        self.assert_reserve();
    }
}
