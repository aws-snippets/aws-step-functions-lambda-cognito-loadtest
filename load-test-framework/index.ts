import cdk = require('@aws-cdk/core');
import lambda = require('@aws-cdk/aws-lambda');
import sfn = require('@aws-cdk/aws-stepfunctions');
import iam = require('@aws-cdk/aws-iam');
import tasks = require('@aws-cdk/aws-stepfunctions-tasks');
import logs = require("@aws-cdk/aws-logs");
import { Key } from '@aws-cdk/aws-kms';
import { UserPool } from '@aws-cdk/aws-cognito'
import { CfnParameter, Duration } from '@aws-cdk/core';

class JobPollerStack extends cdk.Stack {
    constructor(scope: cdk.App, id: string, props: cdk.StackProps = {}) {
        super(scope, id, props);
        
        const prefix = "ApiLoadTest-"

        //INPUT PARAMETERS
        const api_url = new CfnParameter(this, "apiGatewayUrl", {
          type: "String",
          description: "API Gateway URL being load tested."});

        //TODO: register with Cognito
        const customEmailSender = new lambda.Function(this, prefix.concat('customEmailSender'), {
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
        

        const createTestUserIds = new lambda.Function(this, prefix.concat('createTestUserIds'), {
                handler: "lambda_function.lambda_handler",
                code: new lambda.AssetCode('lambda/createTestUserIds'),
                memorySize: 128,
                runtime: lambda.Runtime.PYTHON_3_8,
                timeout: cdk.Duration.seconds(3)
        });

        const cleanUpTestUsers = new lambda.Function(this, prefix.concat('cleanUpTestUsers'), {
                handler: "lambda_function.lambda_handler",
                code: new lambda.AssetCode('lambda/cleanUpTestUsers'),
                memorySize: 512,
                runtime: lambda.Runtime.PYTHON_3_8,
                timeout: cdk.Duration.seconds(600),
                environment: {
                        "client_id": appClient.userPoolClientId,
                        "userpool_id": cognitoUserPool.userPoolId
                    }
        });

        cleanUpTestUsers.role?.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'));
        cleanUpTestUsers.role?.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonCognitoPowerUser'));

        const createTestUsers = new lambda.Function(this, prefix.concat('createTestUsers'), {
                handler: "lambda_function.lambda_handler",
                code: new lambda.AssetCode('lambda/createTestUsers'),
                memorySize: 856,
                runtime: lambda.Runtime.PYTHON_3_8,
                timeout: cdk.Duration.seconds(900),
                environment: {
                        "client_id": appClient.userPoolClientId,
                        "userpool_id": cognitoUserPool.userPoolId
                    }
        });

        createTestUsers.role?.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'));
        createTestUsers.role?.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonCognitoPowerUser'));
        

        const triggerLoadTestPerUser = new lambda.Function(this, prefix.concat('triggerLoadTestPerUser'), {
                handler: "lambda_function.lambda_handler",
                code: new lambda.AssetCode('lambda/triggerLoadTestPerUser'),
                memorySize: 256,
                runtime: lambda.Runtime.PYTHON_3_8,
                timeout: cdk.Duration.seconds(900),
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
          resultPath: "$.createResult"
        });

        const triggerLoadTestPerUserJob = new tasks.LambdaInvoke(this, 'TriggerLoadTest', {
          lambdaFunction: triggerLoadTestPerUser
        });


        const definitionIterator = triggerLoadTestPerUserJob;
                
        const loadTestFanOut = new sfn.Map(this, 'LoadTestFanOut', {
            maxConcurrency: 0,
            inputPath: '$.taskResult.Payload.userNames'
        });
        
        //itemsPath: sfn.JsonPath.stringAt('$.taskResult.userNames')
            
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
            },
            timeout: Duration.minutes(15)
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
            },
            timeout: Duration.minutes(10)
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
new JobPollerStack(app, 'aws-apiloadtest', {description: "Serverless API Gateway Load Testing Framework. Run following CLI command after stack is deployed, Execute following CLI command: aws cognito-idp update-user-pool --user-pool-id INSERT_POOL_ID --lambda-config \"CustomEmailSender={LambdaVersion=V1_0,LambdaArn=INSERT_LAMBDA_ARN},KMSKeyID=KMS_KEY_ARN\""});
app.synth();
