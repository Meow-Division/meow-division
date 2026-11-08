// contract/tests/items.rs — the items contract on a local NEAR sandbox, through real transactions: a run is
// minted once, strangers cannot mint or move a player's items, selling and crafting work, transfer-and-call
// refunds a failed receiver, and the player's function-call key (the "no wallet windows" path) can sell but
// cannot move items to another account. Run: cd contract && cargo test

use near_api::types::transaction::actions::{AccessKeyPermission, FunctionCallPermission};
use near_api::types::transaction::result::{ExecutionSuccess, TransactionResult};
use near_api::{Account, AccountId, Contract, NearGas, NearToken, NetworkConfig, Signer};
use near_sdk::serde_json::{Value, json};
use std::sync::Arc;
use testresult::TestResult;

const ITEMS: &str = "items.sandbox";
const OWNER: &str = "owner.sandbox";
const WALT: &str = "walt.sandbox";
const PLAYER: &str = "player.sandbox";
const STRANGER: &str = "stranger.sandbox";

struct World {
    _sandbox: near_sandbox::Sandbox,
    net: NetworkConfig,
    signer: Arc<Signer>,
    items: Contract,
}

impl World {
    /// Calls `method` on the items contract as `who`, with `deposit` yoctoNEAR attached.
    async fn call(
        &self,
        who: &str,
        method: &str,
        args: Value,
        deposit: u128,
    ) -> TestResult<TransactionResult> {
        Ok(self
            .items
            .call_function(method, args)
            .transaction()
            .deposit(NearToken::from_yoctonear(deposit))
            .gas(NearGas::from_tgas(100))
            .with_signer(who.parse()?, self.signer.clone())
            .send_to(&self.net)
            .await?)
    }

    async fn ok(
        &self,
        who: &str,
        method: &str,
        args: Value,
        deposit: u128,
    ) -> TestResult<ExecutionSuccess> {
        Ok(self
            .call(who, method, args, deposit)
            .await?
            .assert_success())
    }

    async fn fails(&self, who: &str, method: &str, args: Value, deposit: u128) -> TestResult<()> {
        self.call(who, method, args, deposit)
            .await?
            .assert_failure();
        Ok(())
    }

    async fn view<T: near_sdk::serde::de::DeserializeOwned + Send + Sync>(
        &self,
        method: &str,
        args: Value,
    ) -> TestResult<T> {
        Ok(self
            .items
            .call_function(method, args)
            .read_only()
            .fetch_from(&self.net)
            .await?
            .data)
    }

    async fn balances(&self, account: &str, tokens: &[&str]) -> TestResult<Vec<String>> {
        self.view(
            "mt_batch_balance_of",
            json!({ "account_id": account, "token_ids": tokens }),
        )
        .await
    }
}

fn spec(token_id: &str, name: &str) -> Value {
    json!({
        "token_id": token_id,
        "base": { "name": name, "id": "", "symbol": null, "icon": null, "decimals": "0", "base_uri": null,
                  "reference": null, "copies": null, "reference_hash": null },
        "token": { "title": name, "description": null, "media": null, "media_hash": null, "issued_at": null,
                   "expires_at": null, "starts_at": null, "updated_at": null, "extra": null, "reference": null,
                   "reference_hash": null }
    })
}

/// A sandbox with the contract deployed on `items.sandbox` (it is also the game signer, as on mainnet),
/// five items, the medkit recipe, and the player holding 5 gears, 4 bandages and 2 tape from run "r1".
async fn world() -> TestResult<World> {
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let net = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;
    for name in [ITEMS, OWNER, WALT, PLAYER, STRANGER] {
        let id: AccountId = name.parse()?;
        sandbox
            .create_account(id.as_str().parse()?)
            .initial_balance(NearToken::from_near(10))
            .send()
            .await?;
    }
    let wasm_path = cargo_near_build::build_with_cli(Default::default())?;
    let items = Contract(ITEMS.parse()?);
    Contract::deploy(ITEMS.parse()?)
        .use_code(std::fs::read(wasm_path)?)
        .with_init_call("new", json!({ "owner_id": OWNER, "game_signer_id": ITEMS, "walt_id": WALT, "name": "Meow Division items" }))?
        .with_signer(signer.clone())
        .send_to(&net)
        .await?
        .assert_success();
    let w = World {
        _sandbox: sandbox,
        net,
        signer,
        items,
    };
    let tokens = [
        ("gears", "Gears"),
        ("tape", "Duct tape"),
        ("bandages", "Bandages"),
        ("k_medkit", "Medkit"),
        ("s_tiger", "Tiger"),
    ];
    w.ok(
        OWNER,
        "register_tokens",
        json!({ "tokens": tokens.map(|(id, n)| spec(id, n)) }),
        1,
    )
    .await?;
    w.ok(
        OWNER,
        "set_recipes",
        json!({ "recipes": [{ "id": "medkit",
            "inputs": [{ "token_id": "bandages", "amount": "2" }, { "token_id": "tape", "amount": "1" }],
            "outputs": [{ "token_id": "k_medkit", "amount": "1" }] }] }),
        1,
    )
    .await?;
    let mint = json!({ "receiver_id": PLAYER, "token_ids": ["gears", "bandages", "tape"], "amounts": ["5", "4", "2"], "run_id": "r1" });
    let minted = w.ok(ITEMS, "game_mint", mint, 0).await?;
    assert!(minted.json::<bool>()?, "the first mint of a run applies");
    Ok(w)
}

#[tokio::test]
async fn items_contract_on_sandbox() -> TestResult<()> {
    let w = world().await?;

    // a verified run is minted once; the event follows NEP-245
    let again =
        json!({ "receiver_id": PLAYER, "token_ids": ["gears"], "amounts": ["5"], "run_id": "r1" });
    let repeat = w.ok(ITEMS, "game_mint", again.clone(), 0).await?;
    assert!(!repeat.json::<bool>()?, "a repeated run id changes nothing");
    assert_eq!(
        w.balances(PLAYER, &["gears", "bandages", "tape"]).await?,
        ["5", "4", "2"]
    );
    let supply: Option<String> = w.view("mt_supply", json!({ "token_id": "gears" })).await?;
    assert_eq!(supply.as_deref(), Some("5"));

    // nobody else mints, and nobody moves the player's items
    w.fails(
        STRANGER,
        "game_mint",
        json!({ "receiver_id": STRANGER, "token_ids": ["gears"], "amounts": ["9"], "run_id": "x" }),
        0,
    )
    .await?;
    w.fails(
        STRANGER,
        "mt_transfer",
        json!({ "receiver_id": STRANGER, "token_id": "gears", "amount": "1" }),
        1,
    )
    .await?;
    w.fails(
        STRANGER,
        "sell",
        json!({ "token_ids": ["gears"], "amounts": ["1"], "request_id": "s" }),
        0,
    )
    .await?;

    // a standard transfer needs exactly 1 yoctoNEAR (a full-access key, i.e. the player's wallet)
    w.fails(
        PLAYER,
        "mt_transfer",
        json!({ "receiver_id": STRANGER, "token_id": "gears", "amount": "1" }),
        0,
    )
    .await?;
    let sent = w
        .ok(
            PLAYER,
            "mt_transfer",
            json!({ "receiver_id": STRANGER, "token_id": "gears", "amount": "1", "memo": "gift" }),
            1,
        )
        .await?;
    assert!(
        sent.logs()
            .iter()
            .any(|l| l.starts_with("EVENT_JSON:") && l.contains(r#""event":"mt_transfer""#))
    );

    // selling moves items to Walt, once per request id
    let sell = json!({ "token_ids": ["gears"], "amounts": ["2"], "request_id": "s1" });
    let first = w.ok(PLAYER, "sell", sell.clone(), 0).await?;
    assert!(first.json::<bool>()?, "the first sale applies");
    let repeat = w.ok(PLAYER, "sell", sell, 0).await?;
    assert!(
        !repeat.json::<bool>()?,
        "a repeated request id sells nothing"
    );
    assert_eq!(w.balances(WALT, &["gears"]).await?, ["2"]);

    // only Walt hands out his stock
    let give = json!({ "receiver_id": STRANGER, "token_ids": ["gears"], "amounts": ["1"], "request_id": "g1" });
    w.fails(PLAYER, "market_give", give.clone(), 0).await?;
    w.ok(WALT, "market_give", give, 0).await?;
    assert_eq!(w.balances(STRANGER, &["gears"]).await?, ["2"]);

    // crafting burns the inputs and mints the kit
    w.ok(
        PLAYER,
        "craft",
        json!({ "recipe_id": "medkit", "times": 2, "request_id": "c1" }),
        0,
    )
    .await?;
    assert_eq!(
        w.balances(PLAYER, &["bandages", "tape", "k_medkit"])
            .await?,
        ["0", "0", "2"]
    );
    w.fails(
        PLAYER,
        "craft",
        json!({ "recipe_id": "medkit", "request_id": "c2" }),
        0,
    )
    .await?;

    // transfer-and-call to an account with no contract: the call fails and the items come back
    let call = json!({ "receiver_id": STRANGER, "token_id": "k_medkit", "amount": "1", "msg": "" });
    let back = w.ok(PLAYER, "mt_transfer_call", call, 1).await?;
    assert_eq!(back.json::<Vec<String>>()?, ["0"]);
    assert_eq!(w.balances(PLAYER, &["k_medkit"]).await?, ["2"]);

    // metadata
    let meta: Value = w.view("mt_metadata_contract", json!({})).await?;
    assert_eq!(meta["spec"], "mt-1.0.0");
    let base: Vec<Value> = w
        .view(
            "mt_metadata_base_by_token_id",
            json!({ "token_ids": ["tape"] }),
        )
        .await?;
    assert_eq!(base[0]["name"], "Duct tape");
    Ok(())
}

#[tokio::test]
async fn function_call_key_sells_but_cannot_move_items() -> TestResult<()> {
    let w = world().await?;

    // the one approval at connect: a key limited to the items contract and the no-deposit game methods
    let secret = near_api::signer::generate_secret_key()?;
    let permission = AccessKeyPermission::FunctionCall(FunctionCallPermission {
        allowance: Some(NearToken::from_millinear(250)),
        receiver_id: ITEMS.to_string(),
        method_names: ["sell", "craft", "spend", "equip"]
            .map(String::from)
            .to_vec(),
    });
    Account(PLAYER.parse()?)
        .add_key(permission, secret.public_key())
        .with_signer(w.signer.clone())
        .send_to(&w.net)
        .await?
        .assert_success();
    let game_key = Signer::from_secret_key(secret)?;
    let with_game_key = |method: &str, args: Value, deposit: u128| {
        w.items
            .call_function(method, args)
            .transaction()
            .deposit(NearToken::from_yoctonear(deposit))
            .gas(NearGas::from_tgas(50))
            .with_signer(PLAYER.parse().unwrap(), game_key.clone())
            .send_to(&w.net)
    };

    // selling through the game's key: no wallet window
    with_game_key(
        "sell",
        json!({ "token_ids": ["gears"], "amounts": ["1"], "request_id": "k1" }),
        0,
    )
    .await?
    .assert_success();
    assert_eq!(w.balances(WALT, &["gears"]).await?, ["1"]);

    // the same key cannot move items to another account: the standard transfer needs a deposit,
    // and a function-call key cannot attach one
    let moved = with_game_key(
        "mt_transfer",
        json!({ "receiver_id": STRANGER, "token_id": "gears", "amount": "1" }),
        1,
    )
    .await;
    assert!(moved.is_err() || moved?.into_result().is_err());
    assert_eq!(w.balances(PLAYER, &["gears"]).await?, ["4"]);
    Ok(())
}
