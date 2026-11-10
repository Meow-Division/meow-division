// contract/src/market.rs — Walt's market. A player sells by moving items to Walt (`sell`, no deposit, callable
// through the player's function-call key); the server pays the coins at the price `live/economy.js` computes
// from Walt's stock. Walt sells by `market_give`, which only his own key can call. Both are idempotent by
// request id, so a retried request never sells or delivers twice.

use near_sdk::json_types::U128;
use near_sdk::{AccountId, env, near, require};

use crate::{Contract, ContractExt, TokenId, check_batch, check_id};

#[near]
impl Contract {
    /// Moves the caller's items to Walt. Returns false if this request id was already used by the caller.
    pub fn sell(
        &mut self,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
        request_id: String,
    ) -> bool {
        let seller = env::predecessor_account_id();
        require!(seller != self.walt_id, "Walt does not sell to himself");
        check_id(&request_id, "request id");
        let amounts = check_batch(&token_ids, &amounts);
        if !self.record_player_op("sell", &seller, &request_id) {
            return false;
        }
        let walt = self.walt_id.clone();
        self.move_tokens(
            &seller,
            &walt,
            &token_ids,
            &amounts,
            None,
            Some(format!("sell:{request_id}")),
        );
        self.assert_reserve();
        true
    }

    /// Walt hands items from his stock to a buyer (the server has taken the buyer's coins).
    /// Returns false if the request id was already delivered.
    pub fn market_give(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
        request_id: String,
    ) -> bool {
        require!(env::predecessor_account_id() == self.walt_id, "only Walt");
        check_id(&request_id, "request id");
        let amounts = check_batch(&token_ids, &amounts);
        if !self.record_op(format!("give:{request_id}")) {
            return false;
        }
        let walt = self.walt_id.clone();
        self.move_tokens(
            &walt,
            &receiver_id,
            &token_ids,
            &amounts,
            None,
            Some(format!("market:{request_id}")),
        );
        self.assert_reserve();
        true
    }
}
