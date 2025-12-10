import React from 'react';
import { Database, Lock, Key, Shield, ArrowRight, CheckCircle } from 'lucide-react';

const AuroraProxyInfographic = () => {
  return (
    <div className="w-full max-w-6xl mx-auto p-8 bg-gradient-to-br from-slate-50 to-blue-50">
      <h1 className="text-3xl font-bold text-center mb-2 text-slate-800">
        Aurora PostgreSQL via RDS Proxy
      </h1>
      <p className="text-center text-slate-600 mb-8">IAM Roles, Policies & Authentication Flow</p>
      
      {/* Main Flow */}
      <div className="grid grid-cols-1 gap-6 mb-8">
        
        {/* Step 1: Application */}
        <div className="bg-white rounded-lg shadow-lg p-6 border-l-4 border-blue-500">
          <div className="flex items-start gap-4">
            <div className="bg-blue-100 p-3 rounded-lg">
              <Shield className="w-8 h-8 text-blue-600" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-slate-800 mb-2">1. Application/Service</h2>
              <p className="text-slate-600 mb-4">Lambda, EC2, ECS, or other compute service</p>
              
              {/* IAM Role */}
              <div className="bg-blue-50 rounded-lg p-4 mb-3">
                <h3 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
                  <Lock className="w-4 h-4" />
                  IAM Role (Application Role)
                </h3>
                <div className="text-sm text-slate-700 space-y-1">
                  <p><strong>Trust Policy:</strong> Service principal (lambda.amazonaws.com, ec2.amazonaws.com, etc.)</p>
                </div>
              </div>
              
              {/* Policies */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-green-50 rounded-lg p-4">
                  <h4 className="font-semibold text-green-900 mb-2">Option A: IAM Auth Policy</h4>
                  <div className="text-xs font-mono bg-white p-2 rounded">
                    <pre className="whitespace-pre-wrap">{`{
  "Effect": "Allow",
  "Action": ["rds-db:connect"],
  "Resource": "arn:aws:rds-db:
    region:account:dbuser:
    prxy-ID/username"
}`}</pre>
                  </div>
                </div>
                
                <div className="bg-purple-50 rounded-lg p-4">
                  <h4 className="font-semibold text-purple-900 mb-2">Option B: Secrets Manager Policy</h4>
                  <div className="text-xs font-mono bg-white p-2 rounded">
                    <pre className="whitespace-pre-wrap">{`{
  "Effect": "Allow",
  "Action": [
    "secretsmanager:
     GetSecretValue"
  ],
  "Resource": "secret-arn"
}`}</pre>
                  </div>
                </div>
              </div>
              
              {/* Action */}
              <div className="mt-4 bg-amber-50 border-l-4 border-amber-400 p-3 rounded">
                <p className="text-sm font-semibold text-amber-900">
                  <Key className="w-4 h-4 inline mr-2" />
                  Action: Generates IAM auth token (15 min validity)
                </p>
                <code className="text-xs text-amber-800 block mt-1">auth.BuildAuthToken(endpoint, region, username, credentials)</code>
              </div>
            </div>
          </div>
        </div>
        
        {/* Arrow */}
        <div className="flex justify-center">
          <ArrowRight className="w-8 h-8 text-slate-400" />
        </div>
        
        {/* Step 2: RDS Proxy */}
        <div className="bg-white rounded-lg shadow-lg p-6 border-l-4 border-orange-500">
          <div className="flex items-start gap-4">
            <div className="bg-orange-100 p-3 rounded-lg">
              <Shield className="w-8 h-8 text-orange-600" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-slate-800 mb-2">2. RDS Proxy</h2>
              <p className="text-slate-600 mb-4">Connection pooling & authentication gateway</p>
              
              {/* IAM Role */}
              <div className="bg-orange-50 rounded-lg p-4 mb-3">
                <h3 className="font-semibold text-orange-900 mb-2 flex items-center gap-2">
                  <Lock className="w-4 h-4" />
                  IAM Role (Proxy Role)
                </h3>
                <div className="text-sm text-slate-700 space-y-1">
                  <p><strong>Trust Policy:</strong> rds.amazonaws.com</p>
                </div>
              </div>
              
              {/* Policy */}
              <div className="bg-orange-50 rounded-lg p-4 mb-3">
                <h4 className="font-semibold text-orange-900 mb-2">Secrets Manager Access Policy</h4>
                <div className="text-xs font-mono bg-white p-2 rounded">
                  <pre className="whitespace-pre-wrap">{`{
  "Effect": "Allow",
  "Action": [
    "secretsmanager:GetSecretValue",
    "secretsmanager:DescribeSecret"
  ],
  "Resource": "secret-arn"
},
{
  "Effect": "Allow",
  "Action": ["kms:Decrypt"],
  "Resource": "kms-key-arn"
}`}</pre>
                </div>
              </div>
              
              {/* Actions */}
              <div className="space-y-2">
                <div className="bg-green-50 border-l-4 border-green-400 p-3 rounded flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <p className="text-sm font-semibold text-green-900">Validates IAM auth token</p>
                </div>
                <div className="bg-green-50 border-l-4 border-green-400 p-3 rounded flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <p className="text-sm font-semibold text-green-900">Checks rds-db:connect permission</p>
                </div>
                <div className="bg-green-50 border-l-4 border-green-400 p-3 rounded flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <p className="text-sm font-semibold text-green-900">Retrieves DB credentials from Secrets Manager</p>
                </div>
                <div className="bg-green-50 border-l-4 border-green-400 p-3 rounded flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <p className="text-sm font-semibold text-green-900">Manages connection pooling</p>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Arrow */}
        <div className="flex justify-center">
          <ArrowRight className="w-8 h-8 text-slate-400" />
        </div>
        
        {/* Step 3: Aurora PostgreSQL */}
        <div className="bg-white rounded-lg shadow-lg p-6 border-l-4 border-indigo-500">
          <div className="flex items-start gap-4">
            <div className="bg-indigo-100 p-3 rounded-lg">
              <Database className="w-8 h-8 text-indigo-600" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-slate-800 mb-2">3. Aurora PostgreSQL</h2>
              <p className="text-slate-600 mb-4">Database cluster</p>
              
              {/* Requirements */}
              <div className="bg-indigo-50 rounded-lg p-4 mb-3">
                <h3 className="font-semibold text-indigo-900 mb-2">Database Configuration</h3>
                <div className="space-y-2">
                  <div className="bg-white p-3 rounded text-sm">
                    <p className="font-semibold text-indigo-900 mb-1">IAM Authentication Enabled</p>
                    <code className="text-xs text-slate-600">rds modify-db-instance --enable-iam-database-authentication</code>
                  </div>
                  <div className="bg-white p-3 rounded text-sm">
                    <p className="font-semibold text-indigo-900 mb-1">Database User Configuration</p>
                    <code className="text-xs text-slate-600">GRANT rds_iam TO db_username;</code>
                  </div>
                </div>
              </div>
              
              {/* Actions */}
              <div className="space-y-2">
                <div className="bg-green-50 border-l-4 border-green-400 p-3 rounded flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <p className="text-sm font-semibold text-green-900">Validates authentication via AWS</p>
                </div>
                <div className="bg-green-50 border-l-4 border-green-400 p-3 rounded flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <p className="text-sm font-semibold text-green-900">Establishes database connection</p>
                </div>
                <div className="bg-green-50 border-l-4 border-green-400 p-3 rounded flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <p className="text-sm font-semibold text-green-900">Enforces PostgreSQL permissions</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Security Groups */}
      <div className="bg-white rounded-lg shadow-lg p-6 border-t-4 border-slate-500">
        <h2 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
          <Shield className="w-6 h-6" />
          Network Security (Security Groups)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-slate-50 rounded-lg p-4">
            <h3 className="font-semibold text-slate-900 mb-2">RDS Proxy Security Group</h3>
            <p className="text-sm text-slate-700">
              <strong>Inbound:</strong> Port 5432 from Application SG<br/>
              <strong>Outbound:</strong> Port 5432 to Aurora SG
            </p>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <h3 className="font-semibold text-slate-900 mb-2">Aurora Security Group</h3>
            <p className="text-sm text-slate-700">
              <strong>Inbound:</strong> Port 5432 from RDS Proxy SG
            </p>
          </div>
        </div>
      </div>
      
      {/* Key Notes */}
      <div className="mt-8 bg-blue-50 border-l-4 border-blue-500 p-4 rounded">
        <h3 className="font-bold text-blue-900 mb-2">Key Points</h3>
        <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
          <li><strong>Token generation:</strong> Done by the application, not by RDS Proxy or database</li>
          <li><strong>Token validity:</strong> 15 minutes - regenerate for long-running connections</li>
          <li><strong>RDS Proxy role:</strong> Needs access to Secrets Manager for DB credentials</li>
          <li><strong>Application role:</strong> Needs rds-db:connect for IAM auth OR secretsmanager:GetSecretValue</li>
          <li><strong>Database setup:</strong> Must enable IAM authentication and grant rds_iam role to users</li>
        </ul>
      </div>
    </div>
  );
};

export default AuroraProxyInfographic;