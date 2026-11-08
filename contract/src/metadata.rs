// contract/src/metadata.rs — the NEP-245 Metadata and Enumeration extensions. Every item has one base
// metadata entry whose id is its token id; names, pictures and rarity live here, so adding an item to the
// game is an owner call to `register_tokens`, never a new deploy.

use near_sdk::json_types::U128;
use near_sdk::{AccountId, near};

use crate::{Contract, ContractExt, TokenId};

pub const MT_SPEC: &str = "mt-1.0.0";

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct MtContractMetadata {
    pub spec: String,
    pub name: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct MtBaseTokenMetadata {
    pub name: String,
    pub id: String,
    pub symbol: Option<String>,
    pub icon: Option<String>,
    pub decimals: Option<String>,
    pub base_uri: Option<String>,
    pub reference: Option<String>,
    pub copies: Option<u64>,
    pub reference_hash: Option<String>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MtTokenMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub media: Option<String>,
    pub media_hash: Option<String>,
    pub issued_at: Option<String>,
    pub expires_at: Option<String>,
    pub starts_at: Option<String>,
    pub updated_at: Option<String>,
    pub extra: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct MtTokenMetadataAll {
    pub base: MtBaseTokenMetadata,
    pub token: MtTokenMetadata,
}

/// NEP-245 `Token`. Items stack (a player holds 12 gears), so no token has a single owner.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Token {
    pub token_id: TokenId,
    pub owner_id: Option<AccountId>,
}

/// What the owner registers for one item: its base metadata (the `id` is set to the token id) and its own metadata.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct TokenSpec {
    pub token_id: TokenId,
    pub base: MtBaseTokenMetadata,
    pub token: MtTokenMetadata,
}

fn page<T>(items: impl Iterator<Item = T>, from_index: Option<U128>, limit: Option<u32>) -> Vec<T> {
    let from = usize::try_from(from_index.map_or(0, |i| i.0)).unwrap_or(usize::MAX);
    items
        .skip(from)
        .take(limit.map_or(usize::MAX, |l| l as usize))
        .collect()
}

#[near]
impl Contract {
    pub fn mt_metadata_contract(&self) -> MtContractMetadata {
        self.metadata.clone()
    }

    pub fn mt_metadata_token_all(
        &self,
        token_ids: Vec<TokenId>,
    ) -> Vec<Option<MtTokenMetadataAll>> {
        token_ids
            .iter()
            .map(|id| {
                self.tokens.get(id).map(|t| MtTokenMetadataAll {
                    base: t.base.clone(),
                    token: t.token.clone(),
                })
            })
            .collect()
    }

    pub fn mt_metadata_token_by_token_id(
        &self,
        token_ids: Vec<TokenId>,
    ) -> Vec<Option<MtTokenMetadata>> {
        token_ids
            .iter()
            .map(|id| self.tokens.get(id).map(|t| t.token.clone()))
            .collect()
    }

    pub fn mt_metadata_base_by_token_id(
        &self,
        token_ids: Vec<TokenId>,
    ) -> Vec<Option<MtBaseTokenMetadata>> {
        token_ids
            .iter()
            .map(|id| self.tokens.get(id).map(|t| t.base.clone()))
            .collect()
    }

    /// Base metadata ids equal token ids in this contract.
    pub fn mt_metadata_base_by_metadata_id(
        &self,
        base_metadata_ids: Vec<String>,
    ) -> Vec<Option<MtBaseTokenMetadata>> {
        self.mt_metadata_base_by_token_id(base_metadata_ids)
    }

    pub fn mt_tokens_base_metadata_all(
        &self,
        from_index: Option<U128>,
        limit: Option<u32>,
    ) -> Vec<MtBaseTokenMetadata> {
        page(
            self.tokens.values().map(|t| t.base.clone()),
            from_index,
            limit,
        )
    }

    pub fn mt_tokens(&self, from_index: Option<U128>, limit: Option<u32>) -> Vec<Token> {
        page(
            self.tokens.keys().map(|id| Token {
                token_id: id.clone(),
                owner_id: None,
            }),
            from_index,
            limit,
        )
    }

    pub fn mt_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u32>,
    ) -> Vec<Token> {
        let held = self.accounts.get(&account_id).cloned().unwrap_or_default();
        page(
            held.into_keys().map(|token_id| Token {
                token_id,
                owner_id: None,
            }),
            from_index,
            limit,
        )
    }
}
