// contract/tests/wallet.rs — wallets made in the game, on a local NEAR sandbox. `game_wallet` creates a name under a
// stand-in for mainnet's `near` registrar (tests/registrar: near-linkdrop's own `create_account`), with the player's
// key as its full-access key and the deposit from the contract; only the game signer calls it, the owner's cap is
// kept, a request id is applied once, and a name taken meanwhile gives the place, the request id and the deposit back.
// Then the update mainnet will get: the code deployed on items.meowdivision.near (contract/res/items-0.1.0.wasm,
// checked against its SHA-256), launched and played on exactly as on mainnet, replaced through the owner's
// `update_contract`; the state reads on, the server's key may now call `game_wallet` too, and no other key changes.
// Run: cd contract && cargo test --test wallet

use near_api::types::json::U64;
use near_api::types::transaction::actions::{
    AccessKey, AccessKeyPermission, Action, AddKeyAction, CreateAccountAction,
    DeployContractAction, FunctionCallAction, FunctionCallPermission, TransferAction,
};
use near_api::types::transaction::result::{ExecutionSuccess, TransactionResult};
use near_api::{
    Account, AccountId, Contract, NearGas, NearToken, NetworkConfig, PublicKey, Signer, Transaction,
};
use near_sdk::serde_json::{Value, json};
use std::sync::Arc;
use testresult::TestResult;

const OWNER: &str = "owner.sandbox";
const REGISTRAR: &str = "registrar.sandbox";
const PLAYER: &str = "player.sandbox";
const STRANGER: &str = "stranger.sandbox";
/// SHA-256 of the code on items.meowdivision.near since 2026-11-09 (contract/mainnet/DEPLOY.md).
const DEPLOYED_SHA256: &str = "9f5b12812dd2539a8b2665561bede508749ee12486d3420be7fe65223b915ce2";
/// The game server's key on mainnet (lib.rs GAME_KEY): only its public half, as the launch added it.
const GAME_KEY: &str = "ed25519:136treJ5sBzc1qHxGHZpFyNPaGQ7tYVjNMeNCxsQpfgv";
const DEPOSIT: u128 = 10_000_000_000_000_000_000_000; // 0.01 NEAR

struct World {
    _sandbox: near_sandbox::Sandbox,
    net: NetworkConfig,
    signer: Arc<Signer>,
    items: AccountId,
}

impl World {
    async fn call(
        &self,
        who: &str,
        method: &str,
        args: Value,
        deposit: u128,
    ) -> TestResult<TransactionResult> {
        Ok(Contract(self.items.clone())
            .call_function(method, args)
            .transaction()
            .deposit(NearToken::from_yoctonear(deposit))
            .gas(NearGas::from_tgas(300))
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

    async fn fails(
        &self,
        who: &str,
        method: &str,
        args: Value,
        deposit: u128,
        why: &str,
    ) -> TestResult<()> {
        let failed = self
            .call(who, method, args, deposit)
            .await?
            .assert_failure();
        let text = format!("{failed:?}");
        assert!(
            text.contains(why),
            "{method} failed, not with {why:?}: {text}"
        );
        Ok(())
    }

    async fn view<T: near_sdk::serde::de::DeserializeOwned + Send + Sync>(
        &self,
        method: &str,
        args: Value,
    ) -> TestResult<T> {
        Ok(Contract(self.items.clone())
            .call_function(method, args)
            .read_only()
            .fetch_from(&self.net)
            .await?
            .data)
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

    async fn keys(&self, account: &str) -> TestResult<Vec<(PublicKey, AccessKey)>> {
        Ok(Account(account.parse()?)
            .list_keys()
            .fetch_from(&self.net)
            .await?
            .data)
    }
}

/// A sandbox with the owner, a player, a stranger and the stand-in registrar deployed on `registrar.sandbox`.
async fn sandbox() -> TestResult<(near_sandbox::Sandbox, NetworkConfig, Arc<Signer>)> {
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let net = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;
    for name in [OWNER, PLAYER, STRANGER, REGISTRAR] {
        sandbox
            .create_account(name.parse()?)
            .initial_balance(NearToken::from_near(20))
            .send()
            .await?;
    }
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("registrar")
        .join("Cargo.toml");
    let opts = cargo_near_build::BuildOpts::builder()
        .manifest_path(manifest.to_string_lossy().to_string())
        .build();
    let registrar = std::fs::read(cargo_near_build::build_with_cli(opts)?)?;
    Contract::deploy(REGISTRAR.parse()?)
        .use_code(registrar)
        .without_init_call()
        .with_signer(signer.clone())
        .send_to(&net)
        .await?
        .assert_success();
    Ok((sandbox, net, signer))
}

fn this_version() -> TestResult<Vec<u8>> {
    Ok(std::fs::read(cargo_near_build::build_with_cli(
        Default::default(),
    )?)?)
}

fn mainnet_args(file: &str) -> TestResult<Value> {
    let at = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("mainnet")
        .join(file);
    Ok(near_sdk::serde_json::from_str(&std::fs::read_to_string(
        at,
    )?)?)
}

fn wallet_args(name: &str, key: &PublicKey, request_id: &str) -> Value {
    json!({ "account_id": format!("{name}.{REGISTRAR}"), "public_key": key, "request_id": request_id })
}

fn open_wallets(left: u32) -> Value {
    json!({ "wallets_left": left, "wallet_deposit": DEPOSIT.to_string(), "registrar_id": REGISTRAR })
}

#[tokio::test]
async fn a_wallet_is_made_through_the_registrar_once_per_request() -> TestResult<()> {
    let (sandbox, net, signer) = sandbox().await?;
    // this version on items.sandbox, which is also the game signer (as on mainnet)
    let items: AccountId = "items.sandbox".parse()?;
    sandbox
        .create_account(items.as_str().parse()?)
        .initial_balance(NearToken::from_near(10))
        .send()
        .await?;
    Contract::deploy(items.clone())
        .use_code(this_version()?)
        .with_init_call(
            "new",
            json!({ "owner_id": OWNER, "game_signer_id": items, "walt_id": "walt.sandbox", "name": "Meow Division items" }),
        )?
        .with_signer(signer.clone())
        .send_to(&net)
        .await?
        .assert_success();
    let w = World {
        _sandbox: sandbox,
        net,
        signer,
        items: items.clone(),
    };
    let me = items.as_str();
    let copper = near_api::signer::generate_secret_key()?.public_key();
    let other = near_api::signer::generate_secret_key()?.public_key();

    // closed until the owner opens it (for names under mainnet's `near` until then), and only the owner, with 1 yoctoNEAR
    let on_mainnet =
        json!({ "account_id": "copper.near", "public_key": copper, "request_id": "r1" });
    w.fails(me, "game_wallet", on_mainnet, 0, "no wallets left")
        .await?;
    w.fails(OWNER, "set_wallets", open_wallets(2), 0, "1 yoctoNEAR")
        .await?;
    w.fails(
        STRANGER,
        "set_wallets",
        open_wallets(2),
        1,
        "only the game account",
    )
    .await?;
    w.ok(OWNER, "set_wallets", open_wallets(2), 1).await?;

    // only the game signer, only a name right under the registrar
    w.fails(
        STRANGER,
        "game_wallet",
        wallet_args("copper", &copper, "r1"),
        0,
        "only the game server",
    )
    .await?;
    let deeper =
        json!({ "account_id": "copper.player.sandbox", "public_key": copper, "request_id": "r1" });
    w.fails(
        me,
        "game_wallet",
        deeper,
        0,
        "a wallet is a name right under the registrar",
    )
    .await?;

    // made: the player's key is the new account's full-access key, the deposit its balance, an event says so
    let made = w
        .ok(me, "game_wallet", wallet_args("copper", &copper, "r1"), 0)
        .await?;
    assert!(made.json::<bool>()?, "the wallet is made");
    assert!(made.receipt_failures().is_empty());
    assert!(made.logs().iter().any(|l| l.starts_with(
        r#"EVENT_JSON:{"standard":"meowdivision","version":"1.0.0","event":"wallet_create""#
    ) && l.contains("copper.registrar.sandbox")));
    let account = format!("copper.{REGISTRAR}");
    let keys = w.keys(&account).await?;
    assert_eq!(keys.len(), 1);
    assert_eq!(keys[0].0, copper);
    assert!(matches!(
        keys[0].1.permission,
        AccessKeyPermission::FullAccess
    ));
    assert_eq!(w.balance(&account).await?, DEPOSIT);
    let wallets: Value = w.view("wallets", json!({})).await?;
    assert_eq!(wallets["wallets_left"], 1);
    assert_eq!(wallets["wallets_made"], 1);

    // the same request again (an answer lost on the way): nothing more
    let again = w
        .ok(me, "game_wallet", wallet_args("copper", &copper, "r1"), 0)
        .await?;
    assert!(!again.json::<bool>()?, "a request id is applied once");
    let wallets: Value = w.view("wallets", json!({})).await?;
    assert_eq!(wallets["wallets_left"], 1);

    // the name taken meanwhile: the registrar refuses, and the place, the request id and the deposit come back
    let before = w.balance(me).await?;
    let taken = w
        .ok(me, "game_wallet", wallet_args("copper", &other, "r2"), 0)
        .await?;
    assert!(!taken.json::<bool>()?, "a taken name makes nothing");
    let wallets: Value = w.view("wallets", json!({})).await?;
    assert_eq!(wallets["wallets_left"], 1);
    assert_eq!(wallets["wallets_made"], 1);
    let done: bool = w.view("op_done", json!({ "key": "wallet:r2" })).await?;
    assert!(!done, "the failed request id is free again");
    let spent = before - w.balance(me).await?;
    assert!(spent < DEPOSIT / 2, "only gas is spent: {spent}");
    assert_eq!(
        w.keys(&account).await?.len(),
        1,
        "the taken account is untouched"
    );

    // the cap
    let nova = w
        .ok(me, "game_wallet", wallet_args("nova", &other, "r2"), 0)
        .await?;
    assert!(nova.json::<bool>()?);
    w.fails(
        me,
        "game_wallet",
        wallet_args("walt", &other, "r3"),
        0,
        "no wallets left",
    )
    .await?;

    // the gas game_wallet takes (server/near.mjs attaches 100 Tgas)
    let tgas = |g: NearGas| g.as_gas() as f64 / 1e12;
    println!(
        "game_wallet: {:.1} Tgas burnt; a taken name {:.1} Tgas",
        tgas(made.total_gas_burnt),
        tgas(taken.total_gas_burnt)
    );
    assert!(made.total_gas_burnt < NearGas::from_tgas(100));
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

fn function_key(
    public_key: PublicKey,
    receiver: &AccountId,
    methods: &[&str],
    near: u128,
) -> Action {
    Action::AddKey(Box::new(AddKeyAction {
        public_key,
        access_key: AccessKey {
            nonce: U64(0),
            permission: AccessKeyPermission::FunctionCall(FunctionCallPermission {
                allowance: Some(NearToken::from_yoctonear(near)),
                receiver_id: receiver.to_string(),
                method_names: methods.iter().map(|m| m.to_string()).collect(),
            }),
        },
    }))
}

fn methods_of(keys: &[(PublicKey, AccessKey)], key: &PublicKey) -> Option<(Vec<String>, u128)> {
    keys.iter()
        .find(|(k, _)| k == key)
        .and_then(|(_, a)| match &a.permission {
            AccessKeyPermission::FunctionCall(p) => Some((
                p.method_names.clone(),
                p.allowance.map_or(0, |n| n.as_yoctonear()),
            )),
            AccessKeyPermission::FullAccess => None,
        })
}

#[tokio::test]
async fn the_deployed_contract_updates_and_gives_the_server_key_game_wallet() -> TestResult<()> {
    let old = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("res")
            .join("items-0.1.0.wasm"),
    )?;
    let sha = near_sdk::env::sha256(&old);
    let hex: String = sha.iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(
        hex, DEPLOYED_SHA256,
        "res/items-0.1.0.wasm is the deployed code"
    );
    let (sandbox, net, signer) = sandbox().await?;
    let owner: AccountId = OWNER.parse()?;
    let items: AccountId = format!("items.{OWNER}").parse()?;
    let game_key: PublicKey = GAME_KEY.parse()?;
    let tester = near_api::signer::generate_secret_key()?;

    // the launch of 2026-11-09 with the deployed code: one transaction from the owner, no full-access key; the
    // server's key (its public half: the private one is the server's) and a second key this test signs with
    let mut init = mainnet_args("new.json")?;
    init["owner_id"] = json!(owner);
    init["game_signer_id"] = json!(items);
    let walt = format!("walt.{OWNER}");
    init["walt_id"] = json!(walt);
    let one = 1_000_000_000_000_000_000_000_000u128;
    Transaction::construct(owner.clone(), items.clone())
        .add_actions(vec![
            Action::CreateAccount(CreateAccountAction {}),
            Action::Transfer(TransferAction {
                deposit: NearToken::from_millinear(5500),
            }),
            Action::DeployContract(DeployContractAction { code: old }),
            call_action("new", &init, 30, 0)?,
            call_action(
                "register_tokens",
                &mainnet_args("register_tokens.json")?,
                100,
                1,
            )?,
            call_action("set_recipes", &mainnet_args("set_recipes.json")?, 60, 1)?,
            function_key(game_key, &items, &["game_mint", "game_burn"], one),
            function_key(
                tester.public_key(),
                &items,
                &["game_mint", "game_burn"],
                one / 4,
            ),
        ])
        .with_signer(signer.clone())
        .send_to(&net)
        .await?
        .assert_success();
    let w = World {
        _sandbox: sandbox,
        net,
        signer: signer.clone(),
        items: items.clone(),
    };
    let game = Signer::from_secret_key(tester.clone())?;
    let as_server = |method: &str, args: Value| {
        Contract(items.clone())
            .call_function(method, args)
            .transaction()
            .gas(NearGas::from_tgas(50))
            .with_signer(items.clone(), game.clone())
            .send_to(&w.net)
    };

    // played on: a run minted, a sale to Walt, a medkit crafted (the mainnet recipe: 2 bandages, 1 antiseptic)
    let mint = json!({ "receiver_id": PLAYER, "token_ids": ["gears", "bandages", "antiseptic"], "amounts": ["5", "4", "2"], "run_id": "r1" });
    as_server("game_mint", mint.clone()).await?.assert_success();
    w.ok(
        PLAYER,
        "sell",
        json!({ "token_ids": ["gears"], "amounts": ["2"], "request_id": "s1" }),
        0,
    )
    .await?;
    w.ok(
        PLAYER,
        "craft",
        json!({ "recipe_id": "medkit", "times": 2, "request_id": "c1" }),
        0,
    )
    .await?;
    let version: String = w.view("version", json!({})).await?;
    assert_eq!(version, "0.1.0");
    let holdings: Value = w
        .view("holdings_of", json!({ "account_id": PLAYER }))
        .await?;
    let stock: Value = w.view("holdings_of", json!({ "account_id": walt })).await?;
    let recipes: Value = w.view("recipes", json!({})).await?;
    let tokens: Value = w.view("mt_tokens", json!({})).await?;
    let config: Value = w.view("config", json!({})).await?;
    let keys_before = w.keys(items.as_str()).await?;
    assert_eq!(keys_before.len(), 2);
    let tester_before = methods_of(&keys_before, &tester.public_key());

    // the old code knows no game_wallet: the server answers "not ready" until the update
    w.fails(
        OWNER,
        "game_wallet",
        wallet_args("copper", &tester.public_key(), "w1"),
        0,
        "MethodNotFound",
    )
    .await?;

    // the update, as contract/mainnet/launch.html sends it: the owner's update_contract with this version's code
    let code = this_version()?;
    let update = json!({ "code": near_sdk::json_types::Base64VecU8::from(code.clone()) });
    w.fails(
        STRANGER,
        "update_contract",
        update.clone(),
        1,
        "only the game account",
    )
    .await?;
    let updated = w.ok(OWNER, "update_contract", update, 1).await?;
    assert!(
        updated.receipt_failures().is_empty(),
        "deploy, migrate and the re-key all applied: {:?}",
        updated.receipt_failures()
    );

    // the state reads on: every item, recipe, balance, role and applied id as before
    let version: String = w.view("version", json!({})).await?;
    assert_eq!(version, "0.2.0");
    let after: Value = w
        .view("holdings_of", json!({ "account_id": PLAYER }))
        .await?;
    assert_eq!(after, holdings);
    assert_eq!(
        w.view::<Value>("holdings_of", json!({ "account_id": walt }))
            .await?,
        stock
    );
    assert_eq!(w.view::<Value>("recipes", json!({})).await?, recipes);
    assert_eq!(w.view::<Value>("mt_tokens", json!({})).await?, tokens);
    assert_eq!(w.view::<Value>("config", json!({})).await?, config);
    let kits: Vec<String> = w
        .view(
            "mt_batch_balance_of",
            json!({ "account_id": PLAYER, "token_ids": ["k_medkit"] }),
        )
        .await?;
    assert_eq!(kits, ["2"]);
    let repeat = as_server("game_mint", mint).await?.assert_success();
    assert!(
        !repeat.json::<bool>()?,
        "a run minted before the update stays minted"
    );
    let wallets: Value = w.view("wallets", json!({})).await?;
    assert_eq!(
        wallets,
        json!({ "registrar_id": "near", "wallets_left": 0, "wallet_deposit": DEPOSIT.to_string(), "wallets_made": 0 })
    );

    // the server's key: the same public key, now also game_wallet, a full 1 NEAR allowance; the other key as it was
    let keys = w.keys(items.as_str()).await?;
    assert_eq!(keys.len(), 2, "no key added or lost");
    assert!(
        keys.iter()
            .all(|(_, a)| !matches!(a.permission, AccessKeyPermission::FullAccess))
    );
    assert_eq!(
        methods_of(&keys, &game_key),
        Some((
            vec![
                "game_mint".to_string(),
                "game_burn".to_string(),
                "game_wallet".to_string()
            ],
            one
        ))
    );
    // (its allowance only went down by the gas of the mint it signed since)
    let (methods, left) = methods_of(&keys, &tester.public_key()).ok_or("the test key is gone")?;
    let (methods_before, left_before) = tester_before.ok_or("no test key")?;
    assert_eq!(methods, methods_before);
    assert!(left <= left_before && left > left_before - one / 100);
    let blocked = as_server(
        "game_wallet",
        wallet_args("copper", &tester.public_key(), "w1"),
    )
    .await;
    assert!(
        blocked.is_err() || blocked?.into_result().is_err(),
        "a key the update did not touch still cannot call game_wallet"
    );

    // the new method works on the old state: the owner moves the signer role to itself for this check
    w.ok(OWNER, "set_roles", json!({ "game_signer_id": OWNER }), 1)
        .await?;
    // (the owner's call as mainnet gets it, contract/mainnet/set_wallets.json, with the stand-in registrar)
    let mut open = mainnet_args("set_wallets.json")?;
    assert_eq!(open["wallet_deposit"], DEPOSIT.to_string());
    open["registrar_id"] = json!(REGISTRAR);
    w.ok(OWNER, "set_wallets", open, 1).await?;
    let made = w
        .ok(
            OWNER,
            "game_wallet",
            wallet_args("copper", &tester.public_key(), "w1"),
            0,
        )
        .await?;
    assert!(made.json::<bool>()?);
    let tgas = |g: NearGas| g.as_gas() as f64 / 1e12;
    println!(
        "update_contract from 0.1.0 ({} bytes of new code): {:.1} Tgas burnt",
        code.len(),
        tgas(updated.total_gas_burnt)
    );
    Ok(())
}
