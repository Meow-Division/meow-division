// contract/src/game.rs — the server's side. After the server has replayed a run and knows what the player
// carried out, `game_mint` sends it to the player's wallet; `game_burn` removes kits used up in a run and the
// daily decay of Walt's stock. Only the game signer may call them, and a run id is applied once: a retry after
// an RPC timeout returns false and changes nothing.

use near_sdk::json_types::U128;
use near_sdk::{AccountId, env, near, require};

use crate::{Contract, ContractExt, TokenId, check_batch, check_id};

#[near]
impl Contract {
    /// Sends a verified run's loot to `receiver_id`. Returns false if `run_id` was already minted.
    pub fn game_mint(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
        run_id: String,
    ) -> bool {
        self.assert_game_signer();
        check_id(&run_id, "run id");
        let amounts = check_batch(&token_ids, &amounts);
        if !self.record_op(format!("mint:{run_id}")) {
            return false;
        }
        self.mint(
            &receiver_id,
            &token_ids,
            &amounts,
            Some(format!("run:{run_id}")),
        );
        self.assert_reserve();
        true
    }

    /// Removes items the game used up (kits taken into a run, Walt's stock decay). Returns false if `op_id`
    /// was already applied.
    pub fn game_burn(
        &mut self,
        owner_id: AccountId,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
        op_id: String,
    ) -> bool {
        self.assert_game_signer();
        check_id(&op_id, "op id");
        let amounts = check_batch(&token_ids, &amounts);
        if !self.record_op(format!("burn:{op_id}")) {
            return false;
        }
        let signer = env::predecessor_account_id();
        self.burn(
            &owner_id,
            &token_ids,
            &amounts,
            Some(signer),
            Some(format!("game:{op_id}")),
        );
        self.assert_reserve();
        true
    }
}

impl Contract {
    fn assert_game_signer(&self) {
        require!(
            env::predecessor_account_id() == self.game_signer_id,
            "only the game server"
        );
    }
}
