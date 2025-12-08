import { RDSClient, CreateDBSnapshotCommand, ModifyDBInstanceCommand, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { mockClient } from "aws-sdk-client-mock";

const rdsMock = mockClient(RDSClient);

beforeEach(() => {
  rdsMock.reset();
});

test("upgrades primary instance without read replicas", async () => {
  rdsMock.on(DescribeDBInstancesCommand).resolves({
    DBInstances: [{ ReadReplicaDBInstanceIdentifiers: [] }]
  });
  rdsMock.on(CreateDBSnapshotCommand).resolves({});
  rdsMock.on(ModifyDBInstanceCommand).resolves({});

  const { upgradeRDS } = await import("./rds-upgrade-standalone");
  await upgradeRDS();

  expect(rdsMock.commandCalls(ModifyDBInstanceCommand)).toHaveLength(1);
});

test("upgrades primary and read replicas", async () => {
  rdsMock.on(DescribeDBInstancesCommand).resolves({
    DBInstances: [{ ReadReplicaDBInstanceIdentifiers: ["replica-1", "replica-2"] }]
  });
  rdsMock.on(CreateDBSnapshotCommand).resolves({});
  rdsMock.on(ModifyDBInstanceCommand).resolves({});

  const { upgradeRDS } = await import("./rds-upgrade-standalone");
  await upgradeRDS();

  expect(rdsMock.commandCalls(ModifyDBInstanceCommand)).toHaveLength(3);
});

test("creates snapshot before upgrade", async () => {
  rdsMock.on(DescribeDBInstancesCommand).resolves({
    DBInstances: [{ ReadReplicaDBInstanceIdentifiers: [] }]
  });
  rdsMock.on(CreateDBSnapshotCommand).resolves({});
  rdsMock.on(ModifyDBInstanceCommand).resolves({});

  const { upgradeRDS } = await import("./rds-upgrade-standalone");
  await upgradeRDS();

  expect(rdsMock.commandCalls(CreateDBSnapshotCommand)).toHaveLength(1);
});
