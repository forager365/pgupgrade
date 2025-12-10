#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AuroraIamStack } from './aurora-iam-stack';

const app = new cdk.App();
new AuroraIamStack(app, 'AuroraIamStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});
