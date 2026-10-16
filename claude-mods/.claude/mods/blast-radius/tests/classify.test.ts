import { describe, expect, test } from "claude-code/testing";
import { classify, classifyAll, manifestResources, stripHeredocs } from "../hooks/blast-radius.mjs";

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
