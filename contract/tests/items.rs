// contract/tests/items.rs — the items contract on a local NEAR sandbox, through real transactions: a run is
// minted once, strangers cannot mint or move a player's items, selling and crafting work, transfer-and-call
// refunds a failed receiver, the player's function-call key (the "no wallet windows" path) can sell but cannot
// move items to another account, the mainnet set-up files (contract/mainnet/*.json) register the whole economy,
// and the launch page's one wallet transaction creates, deploys and sets up the contract with no full-access key,
// whose code then only the owner's `update_contract` can change. Run: cd contract && cargo test

use near_api::types::json::U64;
use near_api::types::transaction::actions::{
    AccessKey, AccessKeyPermission, Action, AddKeyAction, CreateAccountAction,
    DeployContractAction, FunctionCallAction, FunctionCallPermission, TransferAction,
};
use near_api::types::transaction::result::{ExecutionSuccess, TransactionResult};
use near_api::{
    Account, AccountId, Contract, NearGas, NearToken, NetworkConfig, Signer, Transaction,
};
use near_sdk::serde_json::{Value, json};
use std::sync::Arc;
use testresult::TestResult;

const ITEMS: &str = "items.sandbox";
const OWNER: &str = "owner.sandbox";
const WALT: &str = "walt.sandbox";
const PLAYER: &str = "player.sandbox";
const STRANGER: &str = "stranger.sandbox";
const MILLI_NEAR: u128 = 1_000_000_000_000_000_000_000;

struct World {
    _sandbox: near_sandbox::Sandbox,
    net: NetworkConfig,
    signer: Arc<Signer>,
    items: Contract,
    deploy_gas: NearGas,
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

    async fn balance(&self, account: &str) -> TestResult<u128> {
        Ok(Account(account.parse()?)
            .view()
            .fetch_from(&self.net)
            .await?
            .data
            .amount
            .as_yoctonear())
    }

    /// Bytes the items account stores (code and state), which its balance pays for.
    async fn storage(&self) -> TestResult<u64> {
        Ok(Account(ITEMS.parse()?)
            .view()
            .fetch_from(&self.net)
            .await?
            .data
            .storage_usage)
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

/// A sandbox with the five accounts and the contract deployed on `items.sandbox` with `init` as the `new` args.
async fn deployed(init: Value) -> TestResult<World> {
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
    let deploy_gas = Contract::deploy(ITEMS.parse()?)
        .use_code(std::fs::read(wasm_path)?)
        .with_init_call("new", init)?
        .with_signer(signer.clone())
        .send_to(&net)
        .await?
        .assert_success()
        .total_gas_burnt;
    Ok(World {
        _sandbox: sandbox,
        net,
        signer,
        items,
        deploy_gas,
    })
}

/// A sandbox with the contract deployed on `items.sandbox` (it is also the game signer, as on mainnet),
/// five items, the medkit recipe, and the player holding 5 gears, 4 bandages and 2 tape from run "r1".
async fn world() -> TestResult<World> {
    let init = json!({ "owner_id": OWNER, "game_signer_id": ITEMS, "walt_id": WALT, "name": "Meow Division items" });
    let w = deployed(init).await?;
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
    // the stranger holds nothing here yet: the sender pays its storage (the rest of the deposit comes back); once it
    // holds items, 1 yoctoNEAR moves any of them to it (the transfer-and-call below)
    let gift =
        json!({ "receiver_id": STRANGER, "token_id": "gears", "amount": "1", "memo": "gift" });
    w.fails(PLAYER, "mt_transfer", gift.clone(), 1).await?;
    let before = w.balance(PLAYER).await?;
    let sent = w.ok(PLAYER, "mt_transfer", gift, MILLI_NEAR * 10).await?;
    let paid = before - w.balance(PLAYER).await?;
    assert!(
        paid < MILLI_NEAR * 5,
        "only its storage and gas are kept: {paid}"
    );
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

/// A file the human sends on mainnet (contract/mainnet/<file>, written by gen/chainargs.mjs).
fn mainnet_args(file: &str) -> TestResult<Value> {
    let at = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("mainnet")
        .join(file);
    Ok(near_sdk::serde_json::from_str(&std::fs::read_to_string(
        at,
    )?)?)
}

fn list<'a>(v: &'a Value, key: &str) -> TestResult<&'a Vec<Value>> {
    Ok(v[key].as_array().ok_or(format!("{key} is not a list"))?)
}

/// The mainnet set-up exactly as contract/mainnet/DEPLOY.md sends it: the init args name `new`'s parameters,
/// every item and every recipe goes in one call each, and each recipe then crafts. Prints the gas and storage
/// each step takes (`cargo test mainnet -- --nocapture`), the numbers DEPLOY.md budgets with.
#[tokio::test]
async fn mainnet_set_up_registers_the_whole_economy() -> TestResult<()> {
    let mut init = mainnet_args("new.json")?;
    let mut names: Vec<&String> = init
        .as_object()
        .ok_or("new.json is not an object")?
        .keys()
        .collect();
    names.sort();
    assert_eq!(names, ["game_signer_id", "name", "owner_id", "walt_id"]);
    assert_eq!(init["game_signer_id"], "items.meowdivision.near");
    init["owner_id"] = json!(OWNER);
    init["game_signer_id"] = json!(ITEMS);
    init["walt_id"] = json!(WALT);
    let w = deployed(init).await?;
    let at_deploy = w.storage().await?;

    let tokens = mainnet_args("register_tokens.json")?;
    let registered = w.ok(OWNER, "register_tokens", tokens.clone(), 1).await?;
    let with_tokens = w.storage().await?;
    let recipes = mainnet_args("set_recipes.json")?;
    let set = w.ok(OWNER, "set_recipes", recipes.clone(), 1).await?;
    let with_recipes = w.storage().await?;

    // everything is on chain as sent
    let sent = list(&tokens, "tokens")?;
    let listed: Vec<Value> = w.view("mt_tokens", json!({})).await?;
    assert_eq!(listed.len(), sent.len());
    let all: Vec<Value> = w
        .view("mt_metadata_token_all", mainnet_args("token_ids.json")?)
        .await?;
    assert_eq!(all.len(), sent.len());
    for (got, spec) in all.iter().zip(sent) {
        assert_eq!(got["base"]["id"], spec["token_id"]);
        assert_eq!(got["base"]["name"], spec["base"]["name"]);
        assert_eq!(got["token"]["title"], spec["token"]["title"]);
        assert_eq!(got["token"]["media"], spec["token"]["media"]);
    }
    let on_chain: Vec<Value> = w.view("recipes", json!({})).await?;
    assert_eq!(&on_chain, list(&recipes, "recipes")?);

    // each recipe crafts from exactly its inputs
    let mut mint_gas = NearGas::from_gas(0);
    let mut craft_gas = NearGas::from_gas(0);
    for (i, r) in on_chain.iter().enumerate() {
        let parts = |key: &str| -> TestResult<(Vec<Value>, Vec<Value>)> {
            let p = list(r, key)?;
            Ok((
                p.iter().map(|x| x["token_id"].clone()).collect(),
                p.iter().map(|x| x["amount"].clone()).collect(),
            ))
        };
        let (ids, amounts) = parts("inputs")?;
        let mint = json!({ "receiver_id": PLAYER, "token_ids": ids, "amounts": amounts, "run_id": format!("m{i}") });
        mint_gas = mint_gas.max(w.ok(ITEMS, "game_mint", mint, 0).await?.total_gas_burnt);
        let craft = json!({ "recipe_id": r["id"], "request_id": format!("c{i}") });
        craft_gas = craft_gas.max(w.ok(PLAYER, "craft", craft, 0).await?.total_gas_burnt);
        let (out_ids, out_amounts) = parts("outputs")?;
        let out_ids: Vec<&str> = out_ids.iter().filter_map(Value::as_str).collect();
        assert_eq!(
            w.balances(PLAYER, &out_ids).await?,
            out_amounts,
            "{}",
            r["id"]
        );
    }
    let with_player = w.storage().await?;

    let tgas = |g: NearGas| g.as_gas() as f64 / 1e12;
    println!(
        "mainnet set-up on the sandbox: deploy + new {:.1} Tgas, {at_deploy} bytes; register_tokens ({} items) \
         {:.1} Tgas, +{} bytes; set_recipes ({}) {:.1} Tgas, +{} bytes; one player holding the {} kits +{} bytes; \
         game_mint up to {:.1} Tgas, craft up to {:.1} Tgas",
        tgas(w.deploy_gas),
        sent.len(),
        tgas(registered.total_gas_burnt),
        with_tokens - at_deploy,
        on_chain.len(),
        tgas(set.total_gas_burnt),
        with_recipes - with_tokens,
        on_chain.len(),
        with_player - with_recipes,
        tgas(mint_gas),
        tgas(craft_gas),
    );
    // DEPLOY.md attaches 100 Tgas to each set-up call
    assert!(registered.total_gas_burnt < NearGas::from_tgas(100));
    assert!(set.total_gas_burnt < NearGas::from_tgas(100));
    Ok(())
}

fn call_action(method: &str, args: &Value, tgas: u64, deposit: u128) -> TestResult<Action> {
    Ok(Action::FunctionCall(Box::new(FunctionCallAction {
        method_name: method.to_string(),
        args: near_sdk::serde_json::to_vec(args)?,
        gas: NearGas::from_tgas(tgas),
        deposit: NearToken::from_yoctonear(deposit),
    })))
}

/// What contract/mainnet/launch.html asks the wallet of the game account to sign, as one transaction: create the
/// items account, fund it, deploy the code, `new`, register every item and recipe (owner calls: the predecessor is
/// the game account), and add the server's key for `game_mint` and `game_burn`. The account ends with that one
/// function-call key and no full-access key; then the owner replaces the code with `update_contract` and the state
/// stays, while anyone else, or the owner without the yoctoNEAR, is refused.
#[tokio::test]
async fn one_wallet_transaction_launches_the_contract_and_only_the_owner_updates_it()
-> TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let net = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;
    for name in [OWNER, STRANGER, PLAYER] {
        sandbox
            .create_account(name.parse()?)
            .initial_balance(NearToken::from_near(20))
            .send()
            .await?;
    }
    let owner: AccountId = OWNER.parse()?;
    let items: AccountId = format!("items.{OWNER}").parse()?;
    let code = std::fs::read(cargo_near_build::build_with_cli(Default::default())?)?;
    let mut init = mainnet_args("new.json")?;
    init["owner_id"] = json!(owner);
    init["game_signer_id"] = json!(items);
    init["walt_id"] = json!(format!("walt.{OWNER}"));
    let tokens = mainnet_args("register_tokens.json")?;
    let recipes = mainnet_args("set_recipes.json")?;
    let game_secret = near_api::signer::generate_secret_key()?;
    // the same gas as launch.html attaches: 30 + 100 + 60 Tgas of the 300 a transaction may carry
    let launched = Transaction::construct(owner.clone(), items.clone())
        .add_actions(vec![
            Action::CreateAccount(CreateAccountAction {}),
            Action::Transfer(TransferAction {
                deposit: NearToken::from_millinear(5500),
            }),
            Action::DeployContract(DeployContractAction { code: code.clone() }),
            call_action("new", &init, 30, 0)?,
            call_action("register_tokens", &tokens, 100, 1)?,
            call_action("set_recipes", &recipes, 60, 1)?,
            Action::AddKey(Box::new(AddKeyAction {
                public_key: game_secret.public_key(),
                access_key: AccessKey {
                    nonce: U64(0),
                    permission: AccessKeyPermission::FunctionCall(FunctionCallPermission {
                        allowance: Some(NearToken::from_near(1)),
                        receiver_id: items.to_string(),
                        method_names: vec!["game_mint".to_string(), "game_burn".to_string()],
                    }),
                },
            })),
        ])
        .with_signer(signer.clone())
        .send_to(&net)
        .await?
        .assert_success();

    let contract = Contract(items.clone());
    let view = |method: &'static str| {
        let contract = contract.clone();
        let net = net.clone();
        async move {
            TestResult::Ok(
                contract
                    .call_function(method, json!({}))
                    .read_only::<Value>()
                    .fetch_from(&net)
                    .await?
                    .data,
            )
        }
    };
    assert_eq!(
        view("mt_tokens").await?.as_array().map(Vec::len),
        list(&tokens, "tokens").ok().map(Vec::len)
    );
    assert_eq!(view("recipes").await?, recipes["recipes"]);
    assert_eq!(view("config").await?["owner_id"], OWNER);
    let keys = Account(items.clone())
        .list_keys()
        .fetch_from(&net)
        .await?
        .data;
    assert_eq!(keys.len(), 1, "one key: the server's");
    assert!(
        matches!(keys[0].1.permission, AccessKeyPermission::FunctionCall(_)),
        "no full-access key"
    );

    // the server's key mints a run
    let game = Signer::from_secret_key(game_secret)?;
    let mint = json!({ "receiver_id": PLAYER, "token_ids": ["k_medkit"], "amounts": ["2"], "run_id": "r1" });
    contract
        .call_function("game_mint", mint)
        .transaction()
        .gas(NearGas::from_tgas(30))
        .with_signer(items.clone(), game)
        .send_to(&net)
        .await?
        .assert_success();

    // the code: only the owner, with 1 yoctoNEAR, can replace it; the state stays
    let update = |who: &str, deposit: u128| {
        contract
            .call_function(
                "update_contract",
                json!({ "code": near_sdk::json_types::Base64VecU8::from(code.clone()) }),
            )
            .transaction()
            .deposit(NearToken::from_yoctonear(deposit))
            .gas(NearGas::from_tgas(300))
            .with_signer(who.parse().unwrap(), signer.clone())
            .send_to(&net)
    };
    update(STRANGER, 1).await?.assert_failure();
    update(OWNER, 0).await?.assert_failure();
    let updated = update(OWNER, 1).await?.assert_success();
    let held: Vec<String> = contract
        .call_function(
            "mt_batch_balance_of",
            json!({ "account_id": PLAYER, "token_ids": ["k_medkit"] }),
        )
        .read_only()
        .fetch_from(&net)
        .await?
        .data;
    assert_eq!(held, ["2"]);
    assert_eq!(view("recipes").await?, recipes["recipes"]);
    let tgas = |g: NearGas| g.as_gas() as f64 / 1e12;
    println!(
        "launch transaction: {:.1} Tgas burnt; update_contract ({} bytes of code): {:.1} Tgas burnt",
        tgas(launched.total_gas_burnt),
        code.len(),
        tgas(updated.total_gas_burnt),
    );
    Ok(())
}

/// What the game pays for the items it sends (printed, for docs/chain.md): a run's loot to a player new here, the
/// next run's loot to the same player, a sale taking an item off a wallet. Gas is burnt from the contract's balance
/// (its own key signs); storage locks part of that balance (1 byte = 10^19 yoctoNEAR).
#[tokio::test]
async fn what_sending_items_costs() -> TestResult<()> {
    let w = world().await?;
    let tgas = |g: NearGas| g.as_gas() as f64 / 1e12;
    let mut lines = vec![];
    for (what, args) in [
        (
            "first run of a new player (3 kinds)",
            json!({ "receiver_id": STRANGER, "token_ids": ["gears", "bandages", "tape"], "amounts": ["2", "1", "1"], "run_id": "q1" }),
        ),
        (
            "next run, the same kinds",
            json!({ "receiver_id": STRANGER, "token_ids": ["gears", "tape"], "amounts": ["3", "1"], "run_id": "q2" }),
        ),
        (
            "next run, one new kind",
            json!({ "receiver_id": STRANGER, "token_ids": ["k_medkit"], "amounts": ["1"], "run_id": "q3" }),
        ),
    ] {
        let s0 = w.storage().await?;
        let r = w.ok(ITEMS, "game_mint", args, 0).await?;
        lines.push(format!(
            "{what}: {:.2} Tgas, +{} bytes",
            tgas(r.total_gas_burnt),
            w.storage().await? as i64 - s0 as i64
        ));
    }
    let s0 = w.storage().await?;
    let r = w
        .ok(
            ITEMS,
            "game_burn",
            json!({ "owner_id": STRANGER, "token_ids": ["gears"], "amounts": ["2"], "op_id": "sell1" }),
            0,
        )
        .await?;
    lines.push(format!(
        "a sale (game_burn): {:.2} Tgas, +{} bytes",
        tgas(r.total_gas_burnt),
        w.storage().await? as i64 - s0 as i64
    ));
    println!("COSTS\n{}", lines.join("\n"));
    Ok(())
}
