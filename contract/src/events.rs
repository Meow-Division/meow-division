// contract/src/events.rs — NEP-297 event logs. Every balance change emits one of the three NEP-245 events
// (standard "nep245", version "1.0.0"), so explorers and the game server can follow items without reading state.

use near_sdk::json_types::U128;
use near_sdk::{AccountId, near};

use crate::TokenId;

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct MtMintLog {
    pub owner_id: AccountId,
    pub token_ids: Vec<TokenId>,
    pub amounts: Vec<U128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memo: Option<String>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct MtBurnLog {
    pub owner_id: AccountId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authorized_id: Option<AccountId>,
    pub token_ids: Vec<TokenId>,
    pub amounts: Vec<U128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memo: Option<String>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct MtTransferLog {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authorized_id: Option<AccountId>,
    pub old_owner_id: AccountId,
    pub new_owner_id: AccountId,
    pub token_ids: Vec<TokenId>,
    pub amounts: Vec<U128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memo: Option<String>,
}

/// The NEP-245 events. Variant names become `mt_mint`, `mt_burn`, `mt_transfer` in the log.
#[near(event_json(standard = "nep245"))]
pub enum MtEvent {
    #[event_version("1.0.0")]
    MtMint(Vec<MtMintLog>),
    #[event_version("1.0.0")]
    MtBurn(Vec<MtBurnLog>),
    #[event_version("1.0.0")]
    MtTransfer(Vec<MtTransferLog>),
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct EquipLog {
    pub account_id: AccountId,
    pub token_id: Option<TokenId>,
}

/// Game events outside the token standard: which skin a player wears.
#[near(event_json(standard = "meowdivision"))]
pub enum GameEvent {
    #[event_version("1.0.0")]
    Equip(EquipLog),
}

pub(crate) fn to_json(amounts: &[u128]) -> Vec<U128> {
    amounts.iter().map(|&a| U128(a)).collect()
}
