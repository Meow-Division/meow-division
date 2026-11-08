// contract/src/tests.rs — unit tests on the mocked runtime: roles, idempotency, balances and supply. The
// sandbox tests in contract/tests/ cover the same rules through real transactions and receipts.

use near_sdk::json_types::U128;
use near_sdk::test_utils::{VMContextBuilder, get_logs};
use near_sdk::{AccountId, NearToken, testing_env};

use crate::{Contract, MtBaseTokenMetadata, MtTokenMetadata, Part, Recipe, TokenSpec};

fn id(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn owner() -> AccountId {
    id("meowdivision.near")
}
fn items() -> AccountId {
    id("items.meowdivision.near")
}
fn walt() -> AccountId {
    id("walt.meowdivision.near")
}
fn player() -> AccountId {
    id("copper.near")
}

fn as_caller(caller: &AccountId, deposit: NearToken) {
    let mut ctx = VMContextBuilder::new();
    ctx.current_account_id(items())
        .predecessor_account_id(caller.clone())
        .signer_account_id(caller.clone())
        .attached_deposit(deposit)
        .account_balance(NearToken::from_near(10));
    testing_env!(ctx.build());
}

fn spec(token_id: &str) -> TokenSpec {
    TokenSpec {
        token_id: token_id.into(),
        base: MtBaseTokenMetadata {
            name: token_id.into(),
            id: String::new(),
            symbol: None,
            icon: None,
            decimals: Some("0".into()),
            base_uri: None,
            reference: None,
            copies: None,
            reference_hash: None,
        },
        token: MtTokenMetadata::default(),
    }
}

fn amounts(list: &[u128]) -> Vec<U128> {
    list.iter().map(|&a| U128(a)).collect()
}

/// A contract with gears, tape, a medkit kit, a skin and the medkit recipe (2 bandages + 1 tape).
fn setup() -> Contract {
    as_caller(&owner(), NearToken::from_yoctonear(0));
    let mut c = Contract::new(owner(), items(), walt(), "Meow Division items".into());
    as_caller(&owner(), NearToken::from_yoctonear(1));
    c.register_tokens(
        ["gears", "tape", "bandages", "k_medkit", "s_tiger"]
            .iter()
            .map(|t| spec(t))
            .collect(),
    );
    c.set_recipes(vec![Recipe {
        id: "medkit".into(),
        inputs: vec![
            Part {
                token_id: "bandages".into(),
                amount: U128(2),
            },
            Part {
                token_id: "tape".into(),
                amount: U128(1),
            },
        ],
        outputs: vec![Part {
            token_id: "k_medkit".into(),
            amount: U128(1),
        }],
    }]);
    c
}

fn mint_to_player(c: &mut Contract, tokens: &[&str], list: &[u128], run_id: &str) -> bool {
    as_caller(&items(), NearToken::from_yoctonear(0));
    c.game_mint(
        player(),
        tokens.iter().map(|t| t.to_string()).collect(),
        amounts(list),
        run_id.into(),
    )
}

#[test]
fn a_run_is_minted_once() {
    let mut c = setup();
    assert!(mint_to_player(&mut c, &["gears", "tape"], &[5, 2], "run-1"));
    assert!(
        get_logs()[0]
            .starts_with(r#"EVENT_JSON:{"standard":"nep245","version":"1.0.0","event":"mt_mint""#)
    );
    assert!(!mint_to_player(
        &mut c,
        &["gears", "tape"],
        &[5, 2],
        "run-1"
    ));
    assert_eq!(c.mt_balance_of(player(), "gears".into()), U128(5));
    assert_eq!(c.mt_supply("gears".into()), Some(U128(5)));
    assert!(c.op_done("mint:run-1".into()));
}

#[test]
#[should_panic(expected = "only the game server")]
fn a_stranger_cannot_mint() {
    let mut c = setup();
    as_caller(&player(), NearToken::from_yoctonear(0));
    c.game_mint(
        player(),
        vec!["gears".into()],
        amounts(&[1]),
        "run-x".into(),
    );
}

#[test]
#[should_panic(expected = "unknown token")]
fn an_unregistered_token_cannot_be_minted() {
    let mut c = setup();
    mint_to_player(&mut c, &["gpu"], &[1], "run-2");
}

#[test]
fn selling_moves_items_to_walt_once_per_request() {
    let mut c = setup();
    mint_to_player(&mut c, &["gears"], &[5], "run-1");
    as_caller(&player(), NearToken::from_yoctonear(0));
    assert!(c.sell(vec!["gears".into()], amounts(&[3]), "s1".into()));
    assert!(
        get_logs()
            .iter()
            .any(|l| l.contains(r#""event":"mt_transfer""#) && l.contains(r#""memo":"sell:s1""#))
    );
    assert!(!c.sell(vec!["gears".into()], amounts(&[3]), "s1".into()));
    assert_eq!(c.mt_balance_of(player(), "gears".into()), U128(2));
    assert_eq!(c.mt_balance_of(walt(), "gears".into()), U128(3));
    assert_eq!(c.mt_supply("gears".into()), Some(U128(5)));
}

#[test]
#[should_panic(expected = "not enough gears")]
fn nobody_sells_what_they_do_not_hold() {
    let mut c = setup();
    mint_to_player(&mut c, &["gears"], &[1], "run-1");
    as_caller(&id("stranger.near"), NearToken::from_yoctonear(0));
    c.sell(vec!["gears".into()], amounts(&[1]), "s1".into());
}

#[test]
fn walt_gives_from_his_stock_only() {
    let mut c = setup();
    mint_to_player(&mut c, &["gears"], &[4], "run-1");
    as_caller(&player(), NearToken::from_yoctonear(0));
    c.sell(vec!["gears".into()], amounts(&[4]), "s1".into());
    as_caller(&walt(), NearToken::from_yoctonear(0));
    assert!(c.market_give(
        id("buyer.near"),
        vec!["gears".into()],
        amounts(&[1]),
        "b1".into()
    ));
    assert!(!c.market_give(
        id("buyer.near"),
        vec!["gears".into()],
        amounts(&[1]),
        "b1".into()
    ));
    assert_eq!(c.mt_balance_of(id("buyer.near"), "gears".into()), U128(1));
    assert_eq!(c.mt_balance_of(walt(), "gears".into()), U128(3));
}

#[test]
#[should_panic(expected = "only Walt")]
fn only_walt_gives() {
    let mut c = setup();
    as_caller(&player(), NearToken::from_yoctonear(0));
    c.market_give(player(), vec!["gears".into()], amounts(&[1]), "b1".into());
}

#[test]
fn crafting_burns_inputs_and_mints_the_kit() {
    let mut c = setup();
    mint_to_player(&mut c, &["bandages", "tape"], &[5, 2], "run-1");
    as_caller(&player(), NearToken::from_yoctonear(0));
    assert!(c.craft("medkit".into(), Some(2), "c1".into()));
    assert!(!c.craft("medkit".into(), Some(2), "c1".into()));
    assert_eq!(
        c.mt_batch_balance_of(
            player(),
            vec!["bandages".into(), "tape".into(), "k_medkit".into()]
        ),
        amounts(&[1, 0, 2])
    );
    assert_eq!(
        c.mt_batch_supply(vec!["bandages".into(), "k_medkit".into()]),
        vec![Some(U128(1)), Some(U128(2))]
    );
    let tokens: Vec<String> = c
        .mt_tokens_for_owner(player(), None, None)
        .into_iter()
        .map(|t| t.token_id)
        .collect();
    assert_eq!(tokens, vec!["bandages", "k_medkit"]);
}

#[test]
#[should_panic(expected = "not enough tape")]
fn crafting_without_inputs_fails() {
    let mut c = setup();
    mint_to_player(&mut c, &["bandages"], &[2], "run-1");
    as_caller(&player(), NearToken::from_yoctonear(0));
    c.craft("medkit".into(), None, "c1".into());
}

#[test]
fn spending_burns_with_the_purpose_in_the_memo() {
    let mut c = setup();
    mint_to_player(&mut c, &["gears"], &[6], "run-1");
    as_caller(&player(), NearToken::from_yoctonear(0));
    assert!(c.spend(
        vec!["gears".into()],
        amounts(&[6]),
        "build:workbench:1".into(),
        "p1".into()
    ));
    assert!(get_logs()[0].contains(r#""memo":"spend:build:workbench:1:p1""#));
    assert_eq!(c.holdings_of(player()), vec![]);
    assert_eq!(c.mt_supply("gears".into()), Some(U128(0)));
}

#[test]
fn a_skin_is_worn_only_while_held() {
    let mut c = setup();
    mint_to_player(&mut c, &["s_tiger"], &[1], "run-1");
    as_caller(&player(), NearToken::from_yoctonear(0));
    c.equip(Some("s_tiger".into()));
    assert_eq!(c.equipped_of(player()), Some("s_tiger".into()));
    as_caller(&player(), NearToken::from_yoctonear(1));
    c.mt_transfer(id("friend.near"), "s_tiger".into(), U128(1), None, None);
    assert_eq!(c.equipped_of(player()), None);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn a_standard_transfer_needs_one_yocto() {
    let mut c = setup();
    mint_to_player(&mut c, &["gears"], &[1], "run-1");
    as_caller(&player(), NearToken::from_yoctonear(0));
    c.mt_transfer(id("friend.near"), "gears".into(), U128(1), None, None);
}

#[test]
#[should_panic(expected = "a token appears twice in one call")]
fn a_batch_cannot_repeat_a_token() {
    let mut c = setup();
    mint_to_player(&mut c, &["gears", "gears"], &[1, 1], "run-1");
}

#[test]
#[should_panic(expected = "only the game account")]
fn only_the_owner_registers_items() {
    let mut c = setup();
    as_caller(&player(), NearToken::from_yoctonear(1));
    c.register_tokens(vec![spec("gpu")]);
}

#[test]
fn metadata_follows_the_standard() {
    let c = setup();
    assert_eq!(c.mt_metadata_contract().spec, "mt-1.0.0");
    let base = c.mt_metadata_base_by_token_id(vec!["tape".into(), "nope".into()]);
    assert_eq!(base[0].as_ref().map(|b| b.id.as_str()), Some("tape"));
    assert!(base[1].is_none());
    assert_eq!(c.mt_tokens(None, Some(2)).len(), 2);
    assert_eq!(c.mt_tokens_base_metadata_all(Some(U128(4)), None).len(), 1);
}
