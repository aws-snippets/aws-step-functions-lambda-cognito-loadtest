import cdk = require('@aws-cdk/core');
import lambda = require('@aws-cdk/aws-lambda');
import sfn = require('@aws-cdk/aws-stepfunctions');
import iam = require('@aws-cdk/aws-iam');
import tasks = require('@aws-cdk/aws-stepfunctions-tasks');
import logs = require("@aws-cdk/aws-logs");
import * as path from 'path';
import { Key } from '@aws-cdk/aws-kms';
import { UserPool } from '@aws-cdk/aws-cognito'
import { CfnParameter } from '@aws-cdk/core';
import { JsonPath } from '@aws-cdk/aws-stepfunctions';

class LoadTestStack extends cdk.Stack {
    constructor(scope: cdk.App, id: string, props: cdk.StackProps = {}) {
        super(scope, id, props);
        
        const prefix = "apiloadtest-"

        //INPUT PARAMETERS
        const api_url = new CfnParameter(this, "apiGatewayUrl", {
          type: "String",
          description: "API Gateway URL being load tested."});

        //TODO: register with Cognito
        const customEmailSender = new lambda.Function(this, 'customEmailSender', {
          code: new lambda.AssetCode('lambda/customEmailSender'),
          handler: 'index.handler',
          runtime: lambda.Runtime.NODEJS_12_X
        });
        
        customEmailSender.grantInvoke(new iam.ServicePrincipal("cognito-idp.amazonaws.com"));
        const emailSenderKey = new Key(this, prefix.concat("CustomEmailSenderKey"))


        const cognitoUserPool = new UserPool(this, prefix.concat('cognitoUserPool'), {
            userPoolName: prefix.concat("loadtestidp"),
            
        });

        const appClient = cognitoUserPool.addClient("testusers", {
            authFlows: {    
                adminUserPassword: true
            }});
        

        const createTestUserIds = new lambda.Function(this, 'createTestUserIds', {
                handler: "lambda_function.lambda_handler",
                code: new lambda.AssetCode(path.join(__dirname, 'lambda/createTestUserIds')),
                memorySize: 128,
                runtime: lambda.Runtime.PYTHON_3_8,
                timeout: cdk.Duration.seconds(3)
        });
        
        
        const secretManagerLayer = new lambda.LayerVersion(this, 'secretsLayer', {
              code: new lambda.AssetCode(path.join(__dirname, 'layers')),
              compatibleRuntimes: [lambda.Runtime.PYTHON_3_8],
              license: 'Apache-2.0',
              description: 'A layer for secret manager core functions',
        });
        
        secretManagerLayer.addPermission('account-grant', { accountId: this.account });

        const cleanUpTestUsers = new lambda.Function(this, 'cleanUpTestUsers', {
                handler: "lambda_function.lambda_handler",
                code: new lambda.AssetCode(path.join(__dirname,'lambda/cleanUpTestUsers')),
                memorySize: 512,
                runtime: lambda.Runtime.PYTHON_3_8,
                timeout: cdk.Duration.seconds(600),
                layers: [secretManagerLayer],
                environment: {
                        "client_id": appClient.userPoolClientId,
                        "userpool_id": cognitoUserPool.userPoolId
                    }
        });

        cleanUpTestUsers.role?.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'));
        cleanUpTestUsers.role?.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonCognitoPowerUser'));

        const createTestUsers = new lambda.Function(this, 'createTestUsers', {
                handler: "lambda_function.lambda_handler",
                code: new lambda.AssetCode(path.join(__dirname,'lambda/createTestUsers')),
                memorySize: 856,
                runtime: lambda.Runtime.PYTHON_3_8,
                timeout: cdk.Duration.seconds(900),
                layers: [secretManagerLayer],
                environment: {
                        "client_id": appClient.userPoolClientId,
                        "userpool_id": cognitoUserPool.userPoolId
                    }
        });

        createTestUsers.role?.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'));
        createTestUsers.role?.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonCognitoPowerUser'));
        

        const triggerLoadTestPerUser = new lambda.Function(this, 'triggerLoadTestPerUser', {
                handler: "lambda_function.lambda_handler",
                code: new lambda.AssetCode(path.join(__dirname,'lambda/triggerLoadTestPerUser')),
                memorySize: 256,
                runtime: lambda.Runtime.PYTHON_3_8,
                timeout: cdk.Duration.seconds(900),
                layers: [secretManagerLayer],
                environment: {
                        "numberOfCallsPerUser": "100", //Default value, can also be passed in within step function execution input
                        "client_id": appClient.userPoolClientId,
                        "userpool_id": cognitoUserPool.userPoolId,
                        "api_url": api_url.valueAsString
                    }
        });
        
        triggerLoadTestPerUser.role?.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'));
        triggerLoadTestPerUser.role?.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonCognitoPowerUser'));


        //STEP FUNCTIONS

        //LoadTestFanOut
        const createTestUserIdsJob = new tasks.LambdaInvoke(this, 'CreateTestUserIds', {
          lambdaFunction: createTestUserIds,
          inputPath: '$.users',
          resultPath: '$.taskResult'
        });

        //LoadTestCreateUsers   
        const createUsersJob = new tasks.LambdaInvoke(this, 'CreateTestUsers', {
          lambdaFunction: createTestUsers,
          inputPath: '$.users',
          resultPath: '$.createResult',
          outputPath: '$.taskResult.Payload.userNames'
        });

        const triggerLoadTestPerUserJob = new tasks.LambdaInvoke(this, 'TriggerLoadTest', {
          lambdaFunction: triggerLoadTestPerUser,
          resultPath: JsonPath.DISCARD
        });


        const definitionIterator = triggerLoadTestPerUserJob;
                
        const loadTestFanOut = new sfn.Map(this, 'LoadTestFanOut', {
            maxConcurrency: 0,
            inputPath: '$',
            resultPath: JsonPath.DISCARD
        });
        
        loadTestFanOut.iterator(definitionIterator);
        
        const jobValidateInput = new sfn.Choice(this, 'Is Input Valid?');
        const jobValidateNumericInput = new sfn.Fail(this, 'Input validation failed', {
            cause: 'Input Validation Failed. Please ensure NumberOfUser & NumberOfCallsPerUser do not exceed limits.',
            error: 'NumberOfUsers > 1000 OR NumberOfCallsPerUser > 1000',
        });
        const jobDone = new sfn.Pass(this, 'TestComplete', {});


        const coreDefinition = (createTestUserIdsJob)
        .next(createUsersJob)
        .next(loadTestFanOut)
        .next(jobDone)

        const definition = 
        jobValidateInput
            .when(sfn.Condition.numberGreaterThan('$.users.NumberOfUsers', 1000), jobValidateNumericInput)
            .when(sfn.Condition.numberGreaterThan('$.users.NumberOfCallsPerUser', 1000), jobValidateNumericInput)
            .otherwise(coreDefinition)

        const createUsersAndFanOutLogGroup = new logs.LogGroup(this, 'CreateUsersAndFanOutLogGroup');

        new sfn.StateMachine(this, prefix.concat('CreateUsersAndFanOut'), {
            definition,
            logs: {
                destination: createUsersAndFanOutLogGroup, 
                level: sfn.LogLevel.ALL
            }
        });



        //LoadTestDeleteUsers   
        const cleanUpTaskJob = new tasks.LambdaInvoke(this, 'CleanUpTask', {
          lambdaFunction: cleanUpTestUsers
        });
        
        const cleanUpTaskLogGroup = new logs.LogGroup(this, 'CleanUpTaskLogGroup');

        const cleanUpJobDone = new sfn.Pass(this, 'TestCleanUpComplete', {});

        const cleanUpDefinition = cleanUpTaskJob
            .next(cleanUpJobDone)

        new sfn.StateMachine(this, prefix.concat('DeleteTestUsers'), {
            definition: cleanUpDefinition,
            logs: {
                destination: cleanUpTaskLogGroup, 
                level: sfn.LogLevel.ALL
            }
        });

        //END
        
        
        new cdk.CfnOutput(this, 'User Pool ID', {
              value: cognitoUserPool.userPoolId,
              description: 'User Pool ID', 
              exportName: 'UserPoolID', 
            });

        new cdk.CfnOutput(this, 'App Client ID', {
              value: appClient.userPoolClientId,
              description: 'App Client ID', 
              exportName: 'AppClientID', 
            });

        new cdk.CfnOutput(this, 'KMS Key', {
              value: emailSenderKey.keyArn,
              description: 'CustomEmailSender KMS Key ARN', 
              exportName: 'CustomEmailSenderKMSKey', 
            });

        new cdk.CfnOutput(this, 'CustomEmailSender Lambda', {
              value: customEmailSender.functionArn,
              description: 'CustomEmailSender lambda function', 
              exportName: 'CustomEmailSenderLambdaARN', 
            });

    }
}

const app = new cdk.App();
new LoadTestStack(app, 'aws-apiloadtest-framework', {description: "Serverless API Gateway Load Testing Framework."});
app.synth();
