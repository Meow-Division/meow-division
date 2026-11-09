// contract/src/lib.rs — Meow Division items: one NEP-245 multi-token contract for every item, trophy, kit and
// skin in the game. Standard transfers follow NEP-245 (1 yoctoNEAR, full-access key). The game's own methods
// (`game_*`, `market_*`, `sell`, `craft`, `spend`, `equip`) take no deposit so they can run behind
// function-call keys: the player never sees a wallet window after connecting, and none of those methods can
// move an item to an account of the caller's choosing. See contract/README.md for the trade-off.

use std::collections::BTreeMap;

use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::store::{IterableMap, LookupMap, LookupSet};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, env, near, require,
};

mod events;
mod game;
mod market;
mod metadata;
mod player;
mod token;

pub use events::{MtBurnLog, MtEvent, MtMintLog, MtTransferLog};
use metadata::MT_SPEC;
pub use metadata::{
    MtBaseTokenMetadata, MtContractMetadata, MtTokenMetadata, MtTokenMetadataAll, Token, TokenSpec,
};

pub type TokenId = String;

/// One account's items: token id to amount. Kept as one small map per account (the game has a few dozen items),
/// so a whole inventory is one storage read and `mt_tokens_for_owner` needs no extra index.
pub type Holdings = BTreeMap<TokenId, u128>;

/// Most token ids or recipe parts in one call. Bounds gas and log size.
pub const MAX_BATCH: usize = 50;
/// Longest run id or request id the contract records.
pub const MAX_OP_ID: usize = 64;
/// The contract pays storage for every player. It refuses any change that would leave less than this free.
pub const MIN_RESERVE: NearToken = NearToken::from_millinear(500);
/// Gas for the new code's `migrate`, called in the same batch as its deploy by `update_contract`.
pub const MIGRATE_GAS: Gas = Gas::from_tgas(30);

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Tokens,
    Accounts,
    Recipes,
    Equipped,
    Ops,
}

#[near(serializers = [borsh])]
pub struct TokenRecord {
    pub supply: u128,
    pub base: MtBaseTokenMetadata,
    pub token: MtTokenMetadata,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Part {
    pub token_id: TokenId,
    pub amount: U128,
}

/// A crafting recipe (kits at the workbench and the medbay). The numbers mirror `live/economy.js`.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Recipe {
    pub id: String,
    pub inputs: Vec<Part>,
    pub outputs: Vec<Part>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    pub owner_id: AccountId,
    pub game_signer_id: AccountId,
    pub walt_id: AccountId,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Holding {
    pub token_id: TokenId,
    pub amount: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    /// The game account (meowdivision.near): registers items and recipes, sets the roles below.
    owner_id: AccountId,
    /// Signs `game_mint` and `game_burn` after the server has replayed a run.
    game_signer_id: AccountId,
    /// Walt the merchant: his stock is his balance here; he is the only caller of `market_give`.
    walt_id: AccountId,
    metadata: MtContractMetadata,
    tokens: IterableMap<TokenId, TokenRecord>,
    accounts: LookupMap<AccountId, Holdings>,
    recipes: IterableMap<String, Recipe>,
    equipped: LookupMap<AccountId, TokenId>,
    /// Run ids and request ids already applied, so a retried call never mints or sells twice.
    ops: LookupSet<String>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(
        owner_id: AccountId,
        game_signer_id: AccountId,
        walt_id: AccountId,
        name: String,
    ) -> Self {
        Self {
            owner_id,
            game_signer_id,
            walt_id,
            metadata: MtContractMetadata {
                spec: MT_SPEC.to_string(),
                name,
            },
            tokens: IterableMap::new(StorageKey::Tokens),
            accounts: LookupMap::new(StorageKey::Accounts),
            recipes: IterableMap::new(StorageKey::Recipes),
            equipped: LookupMap::new(StorageKey::Equipped),
            ops: LookupSet::new(StorageKey::Ops),
        }
    }

    // ---- owner -------------------------------------------------------------------------------------------

    /// Adds items or replaces their metadata. Supply and balances are untouched.
    #[payable]
    pub fn register_tokens(&mut self, tokens: Vec<TokenSpec>) {
        self.assert_owner();
        require!(
            !tokens.is_empty() && tokens.len() <= MAX_BATCH,
            "between 1 and 50 tokens per call"
        );
        for spec in tokens {
            check_id(&spec.token_id, "token id");
            let mut base = spec.base;
            base.id = spec.token_id.clone();
            let supply = self.tokens.get(&spec.token_id).map_or(0, |t| t.supply);
            self.tokens.insert(
                spec.token_id,
                TokenRecord {
                    supply,
                    base,
                    token: spec.token,
                },
            );
        }
        self.assert_reserve();
    }

    /// Adds or replaces crafting recipes.
    #[payable]
    pub fn set_recipes(&mut self, recipes: Vec<Recipe>) {
        self.assert_owner();
        require!(
            !recipes.is_empty() && recipes.len() <= MAX_BATCH,
            "between 1 and 50 recipes per call"
        );
        for recipe in recipes {
            check_id(&recipe.id, "recipe id");
            for parts in [&recipe.inputs, &recipe.outputs] {
                require!(
                    !parts.is_empty() && parts.len() <= MAX_BATCH,
                    "a recipe needs inputs and outputs"
                );
                for part in parts {
                    require!(
                        self.tokens.contains_key(&part.token_id),
                        "a recipe uses an unregistered token"
                    );
                    require!(part.amount.0 > 0, "recipe amounts are positive");
                }
            }
            self.recipes.insert(recipe.id.clone(), recipe);
        }
        self.assert_reserve();
    }

    #[payable]
    pub fn remove_recipe(&mut self, recipe_id: String) {
        self.assert_owner();
        require!(self.recipes.remove(&recipe_id).is_some(), "no such recipe");
    }

    /// Moves the server signer or Walt to another account (a new server key, a new merchant wallet).
    #[payable]
    pub fn set_roles(&mut self, game_signer_id: Option<AccountId>, walt_id: Option<AccountId>) {
        self.assert_owner();
        if let Some(id) = game_signer_id {
            self.game_signer_id = id;
        }
        if let Some(id) = walt_id {
            self.walt_id = id;
        }
    }

    /// Replaces this contract's code (owner, 1 yoctoNEAR). The contract account holds no full-access key, so this is
    /// the only way to change the code: the new wasm (`code`, base64) is deployed and its `migrate` called in one
    /// batch, and a migration that fails leaves the old code in place.
    #[payable]
    pub fn update_contract(&mut self, code: Base64VecU8) -> Promise {
        self.assert_owner();
        require!(!code.0.is_empty(), "no code");
        Promise::new(env::current_account_id())
            .deploy_contract(Vec::<u8>::from(code))
            .function_call(
                "migrate".to_string(),
                b"{}".to_vec(),
                NearToken::from_yoctonear(0),
                MIGRATE_GAS,
            )
    }

    /// The state after `update_contract`, read as it is. A version that changes the state's layout rewrites this.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        env::state_read().unwrap_or_else(|| env::panic_str("no state to migrate"))
    }

    // ---- views -------------------------------------------------------------------------------------------

    pub fn config(&self) -> Config {
        Config {
            owner_id: self.owner_id.clone(),
            game_signer_id: self.game_signer_id.clone(),
            walt_id: self.walt_id.clone(),
        }
    }

    pub fn version(&self) -> String {
        env!("CARGO_PKG_VERSION").to_string()
    }

    /// Everything an account holds, in one call (the game's inventory screen and Walt's stock).
    pub fn holdings_of(&self, account_id: AccountId) -> Vec<Holding> {
        let held = self.accounts.get(&account_id).cloned().unwrap_or_default();
        held.into_iter()
            .map(|(token_id, amount)| Holding {
                token_id,
                amount: U128(amount),
            })
            .collect()
    }

    pub fn recipes(&self) -> Vec<Recipe> {
        self.recipes.values().cloned().collect()
    }

    /// The skin an account wears, if it still holds it.
    pub fn equipped_of(&self, account_id: AccountId) -> Option<TokenId> {
        let token_id = self.equipped.get(&account_id)?.clone();
        (self.balance(&account_id, &token_id) > 0).then_some(token_id)
    }

    /// Whether a run id (`kind` "mint" or "burn") or a request id ("give", "sell:<account>", ...) was applied.
    pub fn op_done(&self, key: String) -> bool {
        self.ops.contains(&key)
    }
}

impl Contract {
    fn assert_owner(&self) {
        near_sdk::assert_one_yocto();
        require!(
            env::predecessor_account_id() == self.owner_id,
            "only the game account"
        );
    }

    /// Records an operation id; false if it was applied before.
    pub(crate) fn record_op(&mut self, key: String) -> bool {
        self.ops.insert(key)
    }

    /// The contract pays storage for every player, so each change must leave `MIN_RESERVE` free.
    /// Maps cache their writes until flushed, so they are flushed first to measure the real usage
    /// (`LookupSet` writes at once).
    pub(crate) fn assert_reserve(&mut self) {
        self.tokens.flush();
        self.accounts.flush();
        self.recipes.flush();
        self.equipped.flush();
        let locked = env::storage_byte_cost().saturating_mul(u128::from(env::storage_usage()));
        let free = env::account_balance().saturating_sub(locked);
        require!(
            free >= MIN_RESERVE,
            "the items contract needs a storage top-up"
        );
    }
}

/// Token ids, recipe ids, run ids and request ids: short, printable, no spaces.
pub(crate) fn check_id(id: &str, what: &str) {
    let ok = !id.is_empty()
        && id.len() <= MAX_OP_ID
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.' | b':'));
    require!(
        ok,
        format!("bad {what}: 1 to 64 characters of a-z, A-Z, 0-9, _ - . :")
    );
}

/// Validates a batch and returns the amounts as numbers: same lengths, 1 to 50 entries, no repeated token,
/// every amount positive.
pub(crate) fn check_batch(token_ids: &[TokenId], amounts: &[U128]) -> Vec<u128> {
    require!(
        token_ids.len() == amounts.len(),
        "token_ids and amounts differ in length"
    );
    require!(
        !token_ids.is_empty() && token_ids.len() <= MAX_BATCH,
        "between 1 and 50 tokens per call"
    );
    for (i, id) in token_ids.iter().enumerate() {
        require!(
            !token_ids[..i].contains(id),
            "a token appears twice in one call"
        );
    }
    amounts
        .iter()
        .map(|a| {
            require!(a.0 > 0, "amounts are positive");
            a.0
        })
        .collect()
}

#[cfg(test)]
mod tests;
