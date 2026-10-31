import { describe, expect, test } from "claude-code/testing";
import { classify, classifyAll, kubectlPreviewArgv, manifestResources, riskTargets, stripHeredocs, targetsIgnoreDir } from "../hooks/blast-radius.mjs";

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

  test("keeps a path with no variables as it is", () => {
    expect(rm("rm -rf /tmp/x 'a b'")).toEqual({ targets: ["/tmp/x", "a b"], unresolved: [] });
  });
});
