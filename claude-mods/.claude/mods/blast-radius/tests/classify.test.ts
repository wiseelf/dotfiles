import { describe, expect, test } from "claude-code/testing";
import { classify, classifyAll, decisionRecord, kubectlPreviewArgv, manifestResources, maskSecrets, riskTargets, stripHeredocs, targetsIgnoreDir } from "../hooks/blast-radius.mjs";

describe("classifyAll", () => {
  test("returns every risky segment, so an allowed rm can't hide a later one", () => {
    const risks = classifyAll("rm -rf /tmp/x && cd sub && rm -rf ~");
    expect(risks.map((r) => r.targets)).toEqual([["/tmp/x"], ["~"]]);
    expect(risks[1]?.dir).toBe("sub");
  });

  test("returns nothing for a safe command", () => {
    expect(classifyAll("ls -la && git status")).toEqual([]);
  });
});

describe("rm targets", () => {
  test("reads each word after -- as a path", () => {
    expect(classify("rm -rf -- /tmp/x -weird")?.targets).toEqual(["/tmp/x", "-weird"]);
  });

  test("keeps a lone - as a path", () => {
    expect(classify("rm -f - a")?.targets).toEqual(["-", "a"]);
  });
});

describe("terraform and tofu", () => {
  test("holds terraform destroy with its inputs", () => {
    const risk = classify("terraform -chdir=infra destroy -var-file=prod.tfvars -auto-approve");
    expect(risk?.kind).toBe("terraform-destroy");
    expect(risk?.label).toBe("terraform destroy");
  });

  test("holds tofu apply -destroy", () => {
    expect(classify("tofu apply -destroy")?.label).toBe("tofu apply -destroy");
  });

  test("passes terraform plan and plain apply", () => {
    expect(classify("terraform plan -destroy")).toBe(null);
    expect(classify("terraform apply -var env=prod")).toBe(null);
  });
});

describe("kubectl", () => {
  test("holds kubectl delete with flags before the verb", () => {
    const risk = classify("kubectl -n prod delete deploy api --grace-period 0");
    expect(risk?.kind).toBe("kubectl-delete");
    expect(risk?.targets).toEqual(["deploy", "api"]);
  });

  test("holds kubectl delete -f after cd", () => {
    const risk = classify("cd k8s && kubectl delete -f app.yaml");
    expect(risk?.dir).toBe("k8s");
  });

  test("passes a server dry run and read-only verbs", () => {
    expect(classify("kubectl delete pod x --dry-run=server")).toBe(null);
    expect(classify("kubectl get pods -n delete")).toBe(null);
  });

  test("holds an explicit --dry-run=none", () => {
    expect(classify("kubectl delete pod x --dry-run=none")?.kind).toBe("kubectl-delete");
  });

  test("keeps only the scope flags in the preview, so it can't send the token elsewhere", () => {
    const risk = classify("kubectl delete pod x -n prod --context c --server=https://evil --insecure-skip-tls-verify --kubeconfig k.yaml --token t --as admin -l app=a");
    expect(risk && kubectlPreviewArgv(risk)).toEqual(["kubectl", "get", "pod", "x", "-n", "prod", "--context", "c", "-l", "app=a", "-o", "name"]);
  });
});

describe("helm", () => {
  test("holds helm uninstall and its aliases", () => {
    expect(classify("helm uninstall api -n prod")?.releases).toEqual(["api"]);
    expect(classify("helm del api")?.kind).toBe("helm-uninstall");
  });

  test("passes helm dry run and other verbs", () => {
    expect(classify("helm uninstall api --dry-run")).toBe(null);
    expect(classify("helm upgrade api ./chart")).toBe(null);
  });
});

describe("manifestResources", () => {
  test("lists kind/name for each document", () => {
    const manifest = [
      "---",
      "# Source: api/templates/svc.yaml",
      "apiVersion: v1",
      "kind: Service",
      "metadata:",
      "  labels:",
      "    app: api",
      "  name: api",
      "---",
      "kind: Deployment",
      "metadata:",
      '  name: "api-web"',
      "",
    ].join("\n");
    expect(manifestResources(manifest)).toEqual(["service/api", "deployment/api-web"]);
  });
});

describe("upstream commands still work", () => {
  test("holds rm -rf", () => {
    expect(classify("rm -rf build")?.kind).toBe("rm");
  });

  test("passes a command named like an Object method", () => {
    expect(classify("constructor foo")).toBe(null);
  });
});

describe("heredocs", () => {
  test("ignores commands inside a heredoc body", () => {
    const command = ["cat > /tmp/body.md <<'EOF'", "rm -rf ~", "git push --force origin main", "EOF", "gh pr create --body-file /tmp/body.md"].join("\n");
    expect(classifyAll(command)).toEqual([]);
  });

  test("examines commands after the heredoc ends", () => {
    expect(classify(["cat <<-EOF > x", "\ttext", "\tEOF", "rm -rf build"].join("\n"))?.targets).toEqual(["build"]);
  });

  test("keeps a here-string line", () => {
    expect(stripHeredocs("cat <<< hi\nrm -rf a")).toBe("cat <<< hi\nrm -rf a");
  });
});

describe("protected branches", () => {
  test("passes a force push to a feature branch", () => {
    expect(classify("git push --force origin feat/x")).toBe(null);
    expect(classify("git push origin +feat/x")).toBe(null);
  });

  test("holds a force push to main or master", () => {
    expect(classify("git push -f origin main")?.kind).toBe("git-push-force");
    expect(classify("git push --force-with-lease origin HEAD:refs/heads/master")?.kind).toBe("git-push-force");
  });

  test("leaves a force push with no refspec to the repo check", () => {
    expect(classify("git push --force")?.isCurrentBranch).toBe(true);
    expect(classify("git push -f origin HEAD")?.isCurrentBranch).toBe(true);
  });

  test("holds a force push of every branch", () => {
    expect(classify("git push --mirror origin")?.kind).toBe("git-push-force");
  });

  test("passes a normal push and a delete of a feature branch", () => {
    expect(classify("git push -u origin main")).toBe(null);
    expect(classify("git push origin --delete feat/x")).toBe(null);
    expect(classify("git branch -D feat/x")).toBe(null);
  });

  test("holds a delete of main or master", () => {
    expect(classify("git push origin --delete main")?.branches).toEqual(["main"]);
    expect(classify("git push origin :master")?.remote).toBe("origin");
    expect(classify("git branch -D main")?.kind).toBe("git-branch-delete");
  });
});

describe("segment", () => {
  test("records the risky segment of a longer command", () => {
    expect(classify("make build && rm -rf dist | tee log")?.segment).toBe("rm -rf dist");
  });
});

describe("riskTargets", () => {
  test("lists what each kind acts on", () => {
    expect(riskTargets(classify("rm -rf a b")!)).toEqual(["a", "b"]);
    expect(riskTargets(classify("helm uninstall api web")!)).toEqual(["api", "web"]);
    expect(riskTargets(classify("git branch -D main")!)).toEqual(["main"]);
    expect(riskTargets(classify("git push -f origin main")!)).toEqual(["main"]);
  });

  test("returns null for a kind with no targets", () => {
    expect(riskTargets(classify("git reset --hard")!)).toBe(null);
  });
});

describe("subshells", () => {
  test("a $( ) at the end of a segment does not close a subshell", () => {
    expect(classify("(cd sub && d=$(mktemp -d)) > log; rm -rf build")?.dir).toBe(null);
    expect(classify("(cd sub && d=$(mktemp -d) && rm -rf build)")?.dir).toBe("sub");
  });

  test("a quoted or escaped ( does not keep a subshell open", () => {
    expect(classify('(cd /tmp && echo "(") ; rm -rf *')?.dir).toBe(null);
    expect(classify("(cd /tmp && echo '(') ; rm -rf *")?.dir).toBe(null);
    expect(classify("(cd /tmp && echo \\() ; rm -rf *")?.dir).toBe(null);
    expect(classify('(cd /tmp && echo "$(printf ")")") ; rm -rf *')?.dir).toBe(null);
  });
});

describe("targetsIgnoreDir", () => {
  test("is true when each rm target is absolute, so an unknown cd folder does not matter", () => {
    const risk = classify("for d in a b; do cd $d; done; rm -rf /tmp/cstest ~/scratch")!;
    expect(risk.dir).toBe("$d");
    expect(targetsIgnoreDir(risk)).toBe(true);
  });

  test("is false when an rm target is relative to the cd folder", () => {
    expect(targetsIgnoreDir(classify("cd $d && rm -rf /tmp/x build")!)).toBe(false);
  });

  test("is false for a kind that is not rm", () => {
    expect(targetsIgnoreDir(classify("cd /tmp && git reset --hard")!)).toBe(false);
  });
});

describe("rm paths with shell variables", () => {
  const rm = (command: string, env: Record<string, string> = {}) => {
    const risk = classifyAll(command, env).find((r) => r.kind === "rm")!;
    return { targets: risk.targets, unresolved: risk.unresolved };
  };

  test("puts in a value from the same line", () => {
    expect(rm("d=../home/x; rm -rf /tmp/$d")).toEqual({ targets: ["/tmp/../home/x"], unresolved: [] });
    expect(rm('d=something/bla; rm -rf "/tmp/${d}"')).toEqual({ targets: ["/tmp/something/bla"], unresolved: [] });
  });

  test("removes quotes, so /tmp/\"$d\" is not checked as text", () => {
    expect(rm('d="../etc"; rm -rf /tmp/"$d"').targets).toEqual(["/tmp/../etc"]);
  });

  test("checks each value of a for loop", () => {
    expect(rm("for d in a ../b; do rm -rf /tmp/$d; done").targets).toEqual(["/tmp/a", "/tmp/../b"]);
  });

  test("keeps the old value when an assignment possibly does not run", () => {
    expect(rm("d=a; if x; then d=../etc; fi; rm -rf /tmp/$d").targets).toEqual(["/tmp/a", "/tmp/../etc"]);
    expect(rm("d=a; [ -n x ] && d=../etc; rm -rf /tmp/$d").targets).toEqual(["/tmp/a", "/tmp/../etc"]);
    expect(rm("d=a; (d=../etc); rm -rf /tmp/$d").targets).toEqual(["/tmp/a", "/tmp/../etc"]);
  });

  test("uses the environment for a name with no assignment on the line", () => {
    expect(rm("rm -rf $TMPDIR/x", { TMPDIR: "/tmp/" }).targets).toEqual(["/tmp//x"]);
  });

  test("marks a path unresolved when a value can't be known", () => {
    expect(rm("rm -rf /tmp/$d").unresolved).toEqual(["/tmp/$d"]);
    expect(rm('rm -rf "/tmp/$(echo ..)/x"').unresolved).toEqual(["/tmp/$(echo ..)/x"]);
    expect(rm("read d; rm -rf /tmp/$d", { d: "a" }).unresolved).toEqual(["/tmp/$d"]);
    expect(rm("eval x; d=a; rm -rf /tmp/$d").unresolved).toEqual(["/tmp/$d"]);
    expect(rm("case $x in a) d=../etc;; esac; rm -rf /tmp/$d", { d: "a" }).unresolved).toEqual(["/tmp/$d"]);
    expect(rm("d=a rm -rf /tmp/$d").unresolved).toEqual(["/tmp/$d"]);
  });

  test("puts in a new path in $TMPDIR for $(mktemp)", () => {
    const env = { TMPDIR: "/var/folders/x/T/" };
    const inTmp = "/var/folders/x/T/mktemp.XXXXXXXXXX";
    expect(rm('d=$(mktemp -d); rm -rf "$d"', env)).toEqual({ targets: [inTmp], unresolved: [] });
    expect(rm('export P=p TF_DATA_DIR=$(mktemp -d) && terraform init; rm -rf "$TF_DATA_DIR" /tmp/x', env)).toEqual({ targets: [inTmp, "/tmp/x"], unresolved: [] });
    expect(rm('d="$(mktemp -dt scratch)"; rm -rf $d', env).targets).toEqual([inTmp]);
    expect(rm("d=$(mktemp -q -t s); rm -f $d", env).targets).toEqual([inTmp]);
  });

  test("marks a $(mktemp) path unresolved when it can be outside $TMPDIR", () => {
    const env = { TMPDIR: "/var/folders/x/T/" };
    expect(rm("d=$(mktemp -d -p /); rm -rf $d", env).unresolved).toEqual(["$d"]);
    expect(rm("d=$(mktemp --tmpdir=/ -d); rm -rf $d", env).unresolved).toEqual(["$d"]);
    expect(rm("d=$(mktemp x.XXX); rm -rf $d", env).unresolved).toEqual(["$d"]);
    expect(rm("d=$(mktemp -t ../x); rm -rf $d", env).unresolved).toEqual(["$d"]);
    expect(rm("d=$(mktemp -d); rm -rf $d").unresolved).toEqual(["$d"]);
    expect(rm("cd x && d=$(mktemp -d); rm -rf $d", env).unresolved).toEqual(["$d"]);
  });

  test("marks a path below a $(mktemp) folder unresolved, because a glob or .. can't be checked", () => {
    const env = { TMPDIR: "/var/folders/x/T/" };
    expect(rm('d=$(mktemp -d); rm -rf "$d"/*', env).unresolved).toEqual(["$d/*"]);
    expect(rm('d=$(mktemp -d); rm -rf "$d"/../../*', env).unresolved).toEqual(["$d/../../*"]);
    expect(rm('d=$(mktemp -d); rm -rf "$d/sub"', env).unresolved).toEqual(["$d/sub"]);
  });

  test("marks a $(mktemp) path unresolved when an empty $d leaves a real path", () => {
    const env = { TMPDIR: "/var/folders/x/T/", HOME: "/Users/u" };
    expect(rm('export TMPDIR=/../../../tmp/zz; d=$(mktemp -d -t A); rm -rf "$HOME/work$d"', env).unresolved).toEqual(["$HOME/work$d"]);
    expect(rm('d=$(mktemp -d); rm -rf "$HOME/work$d"', env).unresolved).toEqual(["$HOME/work$d"]);
    expect(rm("d=x$(mktemp -d); rm -rf $d", env).unresolved).toEqual(["$d"]);
  });

  test("marks a $(mktemp) path unresolved when the line can redefine mktemp", () => {
    const env = { TMPDIR: "/var/folders/x/T/" };
    expect(rm('mktemp(){ echo $HOME;}; d=$(mktemp -d); rm -rf "$d"', env).unresolved).toEqual(["$d"]);
    expect(rm('mktemp () { echo $HOME; }; d=$(mktemp -d); rm -rf "$d"', env).unresolved).toEqual(["$d"]);
    expect(rm('PATH=/tmp/x:$PATH; d=$(mktemp -d); rm -rf "$d"', env).unresolved).toEqual(["$d"]);
    expect(rm(["shopt -s expand_aliases", "alias mktemp='echo /home'", 'd=$(mktemp -d); rm -rf "$d"'].join("\n"), env).unresolved).toEqual(["$d"]);
  });

  test("marks a $(mktemp) path unresolved when eval hides behind a prefix or quotes", () => {
    const env = { TMPDIR: "/var/folders/x/T/" };
    expect(rm("command eval 'mktemp''(){ echo /;}'; d=$(mktemp -d); rm -rf \"$d\"", env).unresolved).toEqual(["$d"]);
    expect(rm("x=1 eval 'mktemp''(){ echo /;}'; d=$(mktemp -d); rm -rf \"$d\"", env).unresolved).toEqual(["$d"]);
    expect(rm("e''val 'mktemp(){ echo /;}'; d=$(mktemp -d); rm -rf \"$d\"", env).unresolved).toEqual(["$d"]);
    expect(rm("d=/tmp/x; command eval 'd=/'; rm -rf \"$d\"").unresolved).toEqual(["$d"]);
  });

  test("marks each variable unresolved when the line sets IFS", () => {
    expect(rm("IFS=T; d=$(mktemp -d); rm -rf $d", { TMPDIR: "/var/folders/x/T/" }).unresolved).toEqual(["$d"]);
    expect(rm("IFS=a; d=/tmp/a/home/x; rm -rf $d").unresolved).toEqual(["$d"]);
  });

  test("uses only a TMPDIR from the environment that is absolute with no ..", () => {
    expect(rm("TMPDIR=/tmp; d=$(mktemp -d); rm -rf $d", { TMPDIR: "/var/folders/x/T/" }).unresolved).toEqual(["$d"]);
    expect(rm("d=$(mktemp -d); rm -rf $d", { TMPDIR: "/tmp/../Users/u" }).unresolved).toEqual(["$d"]);
    expect(rm("d=$(mktemp -d); rm -rf $d", { TMPDIR: "tmp" }).unresolved).toEqual(["$d"]);
  });

  test("keeps a $(...) with spaces as one word", () => {
    expect(rm("rm -rf $(echo a b)").unresolved).toEqual(["$(echo a b)"]);
  });

  test("keeps the closing brace of ${d}", () => {
    expect(rm("d=a; rm -rf /tmp/${d}").targets).toEqual(["/tmp/a"]);
  });

  test("keeps a path with no variables as it is", () => {
    expect(rm("rm -rf /tmp/x 'a b'")).toEqual({ targets: ["/tmp/x", "a b"], unresolved: [] });
  });
});

describe("maskSecrets", () => {
  test("masks the value of a secret flag, with = or a space", () => {
    expect(maskSecrets("kubectl delete pod x --token=t1")).toBe("kubectl delete pod x --token=***");
    expect(maskSecrets("kubectl delete pod x --token t1 -n prod")).toBe("kubectl delete pod x --token *** -n prod");
    expect(maskSecrets("cli --password 'a b' --api-key=k --client-secret \"c d\"")).toBe("cli --password *** --api-key=*** --client-secret ***");
  });

  test("masks env assignments", () => {
    expect(maskSecrets("PGPASSWORD='a b' rails db:migrate")).toBe("PGPASSWORD=*** rails db:migrate");
    expect(maskSecrets("export TOKEN=abc; rm -rf build")).toBe("export TOKEN=***; rm -rf build");
  });

  test("masks terraform -var values", () => {
    expect(maskSecrets("terraform destroy -var 'db_password=x'")).toBe("terraform destroy -var 'db_password=***'");
    expect(maskSecrets("terraform destroy -var=token=x")).toBe("terraform destroy -var=token=***");
  });

  test("masks credentials in a URL and an Authorization header", () => {
    expect(maskSecrets("git push -f https://user:tok@github.com/o/r main")).toBe("git push -f https://***@github.com/o/r main");
    expect(maskSecrets("curl -H 'Authorization: Bearer abc.def' x")).toBe("curl -H 'Authorization: Bearer ***' x");
  });

  test("removes heredoc bodies", () => {
    expect(maskSecrets(["cat > k <<'EOF'", "secret-key-material", "EOF", "rm -rf a"].join("\n"))).toBe("cat > k <<'EOF'\nrm -rf a");
  });

  test("keeps a command with no secrets as it is", () => {
    expect(maskSecrets("git push --force origin main")).toBe("git push --force origin main");
  });
});

describe("decisionRecord", () => {
  test("records the decision, the kind, the segment and the targets", () => {
    const command = "make && API_TOKEN=x rm -rf build dist";
    const risk = classify(command)!;
    expect(decisionRecord({ at: 0, decision: "proceed", risk, cwd: "/repo", command })).toEqual({
      ts: "1970-01-01T00:00:00.000Z",
      decision: "proceed",
      kind: "rm",
      label: "rm -rf",
      cwd: "/repo",
      segment: "API_TOKEN=*** rm -rf build dist",
      targets: ["build", "dist"],
      command: "make && API_TOKEN=*** rm -rf build dist",
    });
  });

  test("records null targets for a kind with no targets", () => {
    const risk = classify("git reset --hard")!;
    expect(decisionRecord({ at: 0, decision: "cancel", risk, cwd: "/repo", command: "git reset --hard" }).targets).toBe(null);
  });

  test("cuts a long command after masking, so a cut secret is not kept", () => {
    const command = `rm -rf ${"a".repeat(995)} --token=secretvalue`;
    const record = decisionRecord({ at: 0, decision: "timeout", risk: classify(command)!, cwd: "/", command });
    expect(record.command.length).toBe(1001);
    expect(record.command.includes("secret")).toBe(false);
  });
});
