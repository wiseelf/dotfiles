import { describe, expect, test } from "claude-code/testing";
import { classify, manifestResources } from "../hooks/blast-radius.mjs";

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
