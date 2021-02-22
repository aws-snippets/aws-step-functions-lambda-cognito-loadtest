"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cdk = require("@aws-cdk/core");
const lambda = require("@aws-cdk/aws-lambda");
const sfn = require("@aws-cdk/aws-stepfunctions");
const iam = require("@aws-cdk/aws-iam");
const tasks = require("@aws-cdk/aws-stepfunctions-tasks");
const logs = require("@aws-cdk/aws-logs");
const aws_kms_1 = require("@aws-cdk/aws-kms");
const aws_cognito_1 = require("@aws-cdk/aws-cognito");
const core_1 = require("@aws-cdk/core");
class JobPollerStack extends cdk.Stack {
    constructor(scope, id, props = {}) {
        var _a, _b, _c, _d, _e, _f;
        super(scope, id, props);
        const prefix = "ApiLoadTest-";
        //INPUT PARAMETERS
        const api_url = new core_1.CfnParameter(this, "apiGatewayUrl", {
            type: "String",
            description: "API Gateway URL being load tested."
        });
        //TODO: register with Cognito
        const customEmailSender = new lambda.Function(this, prefix.concat('customEmailSender'), {
            code: new lambda.AssetCode('lambda/customEmailSender'),
            handler: 'index.handler',
            runtime: lambda.Runtime.NODEJS_12_X
        });
        customEmailSender.grantInvoke(new iam.ServicePrincipal("cognito-idp.amazonaws.com"));
        const emailSenderKey = new aws_kms_1.Key(this, prefix.concat("CustomEmailSenderKey"));
        const cognitoUserPool = new aws_cognito_1.UserPool(this, prefix.concat('cognitoUserPool'), {
            userPoolName: prefix.concat("loadtestidp"),
        });
        const appClient = cognitoUserPool.addClient("testusers", {
            authFlows: {
                adminUserPassword: true
            }
        });
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
        (_a = cleanUpTestUsers.role) === null || _a === void 0 ? void 0 : _a.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'));
        (_b = cleanUpTestUsers.role) === null || _b === void 0 ? void 0 : _b.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonCognitoPowerUser'));
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
        (_c = createTestUsers.role) === null || _c === void 0 ? void 0 : _c.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'));
        (_d = createTestUsers.role) === null || _d === void 0 ? void 0 : _d.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonCognitoPowerUser'));
        const triggerLoadTestPerUser = new lambda.Function(this, prefix.concat('triggerLoadTestPerUser'), {
            handler: "lambda_function.lambda_handler",
            code: new lambda.AssetCode('lambda/triggerLoadTestPerUser'),
            memorySize: 256,
            runtime: lambda.Runtime.PYTHON_3_8,
            timeout: cdk.Duration.seconds(300),
            environment: {
                "numberOfCallsPerUser": "$.NumberOfCallsPerUser",
                "client_id": appClient.userPoolClientId,
                "userpool_id": cognitoUserPool.userPoolId,
                "api_url": api_url.valueAsString
            }
        });
        (_e = triggerLoadTestPerUser.role) === null || _e === void 0 ? void 0 : _e.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'));
        (_f = triggerLoadTestPerUser.role) === null || _f === void 0 ? void 0 : _f.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonCognitoPowerUser'));
        //TODO: add to step functions
        // new lambda.Function(this, prefix.concat('cleanUpTestUser'), {
        //         handler: "lambda_function.lambda_handler",
        //         code: new lambda.AssetCode('lambda/cleanUpTestUser'),
        //         memorySize: 128,
        //         runtime: lambda.Runtime.PYTHON_3_8,
        //         timeout: cdk.Duration.seconds(10),
        //         environment: {
        //                 "client_id": appClient.userPoolClientId,
        //                 "userpool_id": cognitoUserPool.userPoolId
        //             }
        // });
        // //TODO: add to step functions
        // new lambda.Function(this, prefix.concat('createTestUser'), {
        //         handler: "lambda_function.lambda_handler",
        //         code: new lambda.AssetCode('lambda/createTestUser'),
        //         memorySize: 128,
        //         runtime: lambda.Runtime.PYTHON_3_8,
        //         timeout: cdk.Duration.seconds(10),
        //         environment: {
        //                 "client_id": appClient.userPoolClientId,
        //                 "userpool_id": cognitoUserPool.userPoolId
        //             }
        // });
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
            .next(jobDone);
        const definition = jobValidateInput
            .when(sfn.Condition.numberGreaterThan('$.users.NumberOfUsers', 1000), jobValidateNumericInput)
            .when(sfn.Condition.numberGreaterThan('$.users.NumberOfCallsPerUser', 1000), jobValidateNumericInput)
            .otherwise(coreDefinition);
        const createUsersAndFanOutLogGroup = new logs.LogGroup(this, 'CreateUsersAndFanOutLogGroup');
        new sfn.StateMachine(this, prefix.concat('CreateUsersAndFanOut'), {
            definition,
            logs: {
                destination: createUsersAndFanOutLogGroup,
                level: sfn.LogLevel.ALL
            },
            timeout: core_1.Duration.minutes(15)
        });
        //LoadTestDeleteUsers   
        const cleanUpTaskJob = new tasks.LambdaInvoke(this, 'CleanUpTask', {
            lambdaFunction: cleanUpTestUsers
        });
        const cleanUpTaskLogGroup = new logs.LogGroup(this, 'CleanUpTaskLogGroup');
        const cleanUpJobDone = new sfn.Pass(this, 'TestCleanUpComplete', {});
        const cleanUpDefinition = cleanUpTaskJob
            .next(cleanUpJobDone);
        new sfn.StateMachine(this, prefix.concat('DeleteTestUsers'), {
            definition: cleanUpDefinition,
            logs: {
                destination: cleanUpTaskLogGroup,
                level: sfn.LogLevel.ALL
            },
            timeout: core_1.Duration.minutes(10)
        });
        //END
        new cdk.CfnOutput(this, 'User Pool ID', {
            value: cognitoUserPool.userPoolId,
            description: 'User Pool ID',
            exportName: 'UserPoolID',
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
new JobPollerStack(app, 'aws-apiloadtest', { description: "Serverless API Gateway Load Testing Framework. Run following CLI command after stack is deployed, Execute following CLI command: aws cognito-idp update-user-pool --user-pool-id INSERT_POOL_ID --lambda-config \"CustomEmailSender={LambdaVersion=V1_0,LambdaArn=INSERT_LAMBDA_ARN},KMSKeyID=KMS_KEY_ARN\"" });
app.synth();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLHFDQUFzQztBQUN0Qyw4Q0FBK0M7QUFDL0Msa0RBQW1EO0FBQ25ELHdDQUF5QztBQUN6QywwREFBMkQ7QUFDM0QsMENBQTJDO0FBQzNDLDhDQUF1QztBQUN2QyxzREFBK0M7QUFDL0Msd0NBQXVEO0FBRXZELE1BQU0sY0FBZSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ2xDLFlBQVksS0FBYyxFQUFFLEVBQVUsRUFBRSxRQUF3QixFQUFFOztRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLE1BQU0sR0FBRyxjQUFjLENBQUE7UUFFN0Isa0JBQWtCO1FBQ2xCLE1BQU0sT0FBTyxHQUFHLElBQUksbUJBQVksQ0FBQyxJQUFJLEVBQUUsZUFBZSxFQUFFO1lBQ3RELElBQUksRUFBRSxRQUFRO1lBQ2QsV0FBVyxFQUFFLG9DQUFvQztTQUFDLENBQUMsQ0FBQztRQUV0RCw2QkFBNkI7UUFDN0IsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUMsbUJBQW1CLENBQUMsRUFBRTtZQUN0RixJQUFJLEVBQUUsSUFBSSxNQUFNLENBQUMsU0FBUyxDQUFDLDBCQUEwQixDQUFDO1lBQ3RELE9BQU8sRUFBRSxlQUFlO1lBQ3hCLE9BQU8sRUFBRSxNQUFNLENBQUMsT0FBTyxDQUFDLFdBQVc7U0FDcEMsQ0FBQyxDQUFDO1FBRUgsaUJBQWlCLENBQUMsV0FBVyxDQUFDLElBQUksR0FBRyxDQUFDLGdCQUFnQixDQUFDLDJCQUEyQixDQUFDLENBQUMsQ0FBQztRQUNyRixNQUFNLGNBQWMsR0FBRyxJQUFJLGFBQUcsQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLE1BQU0sQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDLENBQUE7UUFHM0UsTUFBTSxlQUFlLEdBQUcsSUFBSSxzQkFBUSxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsTUFBTSxDQUFDLGlCQUFpQixDQUFDLEVBQUU7WUFDekUsWUFBWSxFQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDO1NBRTdDLENBQUMsQ0FBQztRQUVILE1BQU0sU0FBUyxHQUFHLGVBQWUsQ0FBQyxTQUFTLENBQUMsV0FBVyxFQUFFO1lBQ3JELFNBQVMsRUFBRTtnQkFDUCxpQkFBaUIsRUFBRSxJQUFJO2FBQzFCO1NBQUMsQ0FBQyxDQUFDO1FBR1IsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUMsbUJBQW1CLENBQUMsRUFBRTtZQUNoRixPQUFPLEVBQUUsZ0NBQWdDO1lBQ3pDLElBQUksRUFBRSxJQUFJLE1BQU0sQ0FBQyxTQUFTLENBQUMsMEJBQTBCLENBQUM7WUFDdEQsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxVQUFVO1lBQ2xDLE9BQU8sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7U0FDdkMsQ0FBQyxDQUFDO1FBRUgsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUMsa0JBQWtCLENBQUMsRUFBRTtZQUM5RSxPQUFPLEVBQUUsZ0NBQWdDO1lBQ3pDLElBQUksRUFBRSxJQUFJLE1BQU0sQ0FBQyxTQUFTLENBQUMseUJBQXlCLENBQUM7WUFDckQsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxVQUFVO1lBQ2xDLE9BQU8sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUM7WUFDbEMsV0FBVyxFQUFFO2dCQUNMLFdBQVcsRUFBRSxTQUFTLENBQUMsZ0JBQWdCO2dCQUN2QyxhQUFhLEVBQUUsZUFBZSxDQUFDLFVBQVU7YUFDNUM7U0FDWixDQUFDLENBQUM7UUFFSCxNQUFBLGdCQUFnQixDQUFDLElBQUksMENBQUUsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyx3QkFBd0IsQ0FBQyx5QkFBeUIsQ0FBQyxFQUFFO1FBQy9HLE1BQUEsZ0JBQWdCLENBQUMsSUFBSSwwQ0FBRSxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLHdCQUF3QixDQUFDLHdCQUF3QixDQUFDLEVBQUU7UUFFOUcsTUFBTSxlQUFlLEdBQUcsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsTUFBTSxDQUFDLGlCQUFpQixDQUFDLEVBQUU7WUFDNUUsT0FBTyxFQUFFLGdDQUFnQztZQUN6QyxJQUFJLEVBQUUsSUFBSSxNQUFNLENBQUMsU0FBUyxDQUFDLHdCQUF3QixDQUFDO1lBQ3BELFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUMsVUFBVTtZQUNsQyxPQUFPLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDO1lBQ2xDLFdBQVcsRUFBRTtnQkFDTCxXQUFXLEVBQUUsU0FBUyxDQUFDLGdCQUFnQjtnQkFDdkMsYUFBYSxFQUFFLGVBQWUsQ0FBQyxVQUFVO2FBQzVDO1NBQ1osQ0FBQyxDQUFDO1FBRUgsTUFBQSxlQUFlLENBQUMsSUFBSSwwQ0FBRSxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLHdCQUF3QixDQUFDLHlCQUF5QixDQUFDLEVBQUU7UUFDOUcsTUFBQSxlQUFlLENBQUMsSUFBSSwwQ0FBRSxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLHdCQUF3QixDQUFDLHdCQUF3QixDQUFDLEVBQUU7UUFHN0csTUFBTSxzQkFBc0IsR0FBRyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUMsd0JBQXdCLENBQUMsRUFBRTtZQUMxRixPQUFPLEVBQUUsZ0NBQWdDO1lBQ3pDLElBQUksRUFBRSxJQUFJLE1BQU0sQ0FBQyxTQUFTLENBQUMsK0JBQStCLENBQUM7WUFDM0QsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxVQUFVO1lBQ2xDLE9BQU8sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUM7WUFDbEMsV0FBVyxFQUFFO2dCQUNMLHNCQUFzQixFQUFFLHdCQUF3QjtnQkFDaEQsV0FBVyxFQUFFLFNBQVMsQ0FBQyxnQkFBZ0I7Z0JBQ3ZDLGFBQWEsRUFBRSxlQUFlLENBQUMsVUFBVTtnQkFDekMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxhQUFhO2FBQ25DO1NBQ1osQ0FBQyxDQUFDO1FBRUgsTUFBQSxzQkFBc0IsQ0FBQyxJQUFJLDBDQUFFLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsd0JBQXdCLENBQUMseUJBQXlCLENBQUMsRUFBRTtRQUNySCxNQUFBLHNCQUFzQixDQUFDLElBQUksMENBQUUsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyx3QkFBd0IsQ0FBQyx3QkFBd0IsQ0FBQyxFQUFFO1FBR3BILDZCQUE2QjtRQUM3QixnRUFBZ0U7UUFDaEUscURBQXFEO1FBQ3JELGdFQUFnRTtRQUNoRSwyQkFBMkI7UUFDM0IsOENBQThDO1FBQzlDLDZDQUE2QztRQUM3Qyx5QkFBeUI7UUFDekIsMkRBQTJEO1FBQzNELDREQUE0RDtRQUM1RCxnQkFBZ0I7UUFDaEIsTUFBTTtRQUdOLGdDQUFnQztRQUNoQywrREFBK0Q7UUFDL0QscURBQXFEO1FBQ3JELCtEQUErRDtRQUMvRCwyQkFBMkI7UUFDM0IsOENBQThDO1FBQzlDLDZDQUE2QztRQUM3Qyx5QkFBeUI7UUFDekIsMkRBQTJEO1FBQzNELDREQUE0RDtRQUM1RCxnQkFBZ0I7UUFDaEIsTUFBTTtRQUdOLGdCQUFnQjtRQUVoQixnQkFBZ0I7UUFDaEIsTUFBTSxvQkFBb0IsR0FBRyxJQUFJLEtBQUssQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFO1lBQzdFLGNBQWMsRUFBRSxpQkFBaUI7WUFDakMsU0FBUyxFQUFFLFNBQVM7WUFDcEIsVUFBVSxFQUFFLGNBQWM7U0FDM0IsQ0FBQyxDQUFDO1FBRUgsd0JBQXdCO1FBQ3hCLE1BQU0sY0FBYyxHQUFHLElBQUksS0FBSyxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLEVBQUU7WUFDckUsY0FBYyxFQUFFLGVBQWU7WUFDL0IsU0FBUyxFQUFFLFNBQVM7WUFDcEIsVUFBVSxFQUFFLGdCQUFnQjtTQUM3QixDQUFDLENBQUM7UUFFSCxNQUFNLHlCQUF5QixHQUFHLElBQUksS0FBSyxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLEVBQUU7WUFDaEYsY0FBYyxFQUFFLHNCQUFzQjtTQUN2QyxDQUFDLENBQUM7UUFHSCxNQUFNLGtCQUFrQixHQUFHLHlCQUF5QixDQUFDO1FBRXJELE1BQU0sY0FBYyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUU7WUFDdkQsY0FBYyxFQUFFLENBQUM7WUFDakIsU0FBUyxFQUFFLGdDQUFnQztTQUM5QyxDQUFDLENBQUM7UUFFSCw0REFBNEQ7UUFFNUQsY0FBYyxDQUFDLFFBQVEsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO1FBRTVDLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxHQUFHLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxpQkFBaUIsQ0FBQyxDQUFDO1FBQ2pFLE1BQU0sdUJBQXVCLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSx5QkFBeUIsRUFBRTtZQUMxRSxLQUFLLEVBQUUsa0dBQWtHO1lBQ3pHLEtBQUssRUFBRSxxREFBcUQ7U0FDL0QsQ0FBQyxDQUFDO1FBQ0gsTUFBTSxPQUFPLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFHdkQsTUFBTSxjQUFjLEdBQUcsQ0FBQyxvQkFBb0IsQ0FBQzthQUM1QyxJQUFJLENBQUMsY0FBYyxDQUFDO2FBQ3BCLElBQUksQ0FBQyxjQUFjLENBQUM7YUFDcEIsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBRWQsTUFBTSxVQUFVLEdBQ2hCLGdCQUFnQjthQUNYLElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLGlCQUFpQixDQUFDLHVCQUF1QixFQUFFLElBQUksQ0FBQyxFQUFFLHVCQUF1QixDQUFDO2FBQzdGLElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLGlCQUFpQixDQUFDLDhCQUE4QixFQUFFLElBQUksQ0FBQyxFQUFFLHVCQUF1QixDQUFDO2FBQ3BHLFNBQVMsQ0FBQyxjQUFjLENBQUMsQ0FBQTtRQUU5QixNQUFNLDRCQUE0QixHQUFHLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsOEJBQThCLENBQUMsQ0FBQztRQUU3RixJQUFJLEdBQUcsQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUMsc0JBQXNCLENBQUMsRUFBRTtZQUM5RCxVQUFVO1lBQ1YsSUFBSSxFQUFFO2dCQUNGLFdBQVcsRUFBRSw0QkFBNEI7Z0JBQ3pDLEtBQUssRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLEdBQUc7YUFDMUI7WUFDRCxPQUFPLEVBQUUsZUFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7U0FDaEMsQ0FBQyxDQUFDO1FBSUgsd0JBQXdCO1FBQ3hCLE1BQU0sY0FBYyxHQUFHLElBQUksS0FBSyxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsYUFBYSxFQUFFO1lBQ2pFLGNBQWMsRUFBRSxnQkFBZ0I7U0FDakMsQ0FBQyxDQUFDO1FBRUgsTUFBTSxtQkFBbUIsR0FBRyxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLHFCQUFxQixDQUFDLENBQUM7UUFFM0UsTUFBTSxjQUFjLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxxQkFBcUIsRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVyRSxNQUFNLGlCQUFpQixHQUFHLGNBQWM7YUFDbkMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFBO1FBRXpCLElBQUksR0FBRyxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLE1BQU0sQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFO1lBQ3pELFVBQVUsRUFBRSxpQkFBaUI7WUFDN0IsSUFBSSxFQUFFO2dCQUNGLFdBQVcsRUFBRSxtQkFBbUI7Z0JBQ2hDLEtBQUssRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLEdBQUc7YUFDMUI7WUFDRCxPQUFPLEVBQUUsZUFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7U0FDaEMsQ0FBQyxDQUFDO1FBRUgsS0FBSztRQUdMLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQ2xDLEtBQUssRUFBRSxlQUFlLENBQUMsVUFBVTtZQUNqQyxXQUFXLEVBQUUsY0FBYztZQUMzQixVQUFVLEVBQUUsWUFBWTtTQUN6QixDQUFDLENBQUM7UUFFUCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBRTtZQUM3QixLQUFLLEVBQUUsY0FBYyxDQUFDLE1BQU07WUFDNUIsV0FBVyxFQUFFLCtCQUErQjtZQUM1QyxVQUFVLEVBQUUseUJBQXlCO1NBQ3RDLENBQUMsQ0FBQztRQUVQLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsMEJBQTBCLEVBQUU7WUFDOUMsS0FBSyxFQUFFLGlCQUFpQixDQUFDLFdBQVc7WUFDcEMsV0FBVyxFQUFFLG1DQUFtQztZQUNoRCxVQUFVLEVBQUUsNEJBQTRCO1NBQ3pDLENBQUMsQ0FBQztJQUVYLENBQUM7Q0FDSjtBQUVELE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBQzFCLElBQUksY0FBYyxDQUFDLEdBQUcsRUFBRSxpQkFBaUIsRUFBRSxFQUFDLFdBQVcsRUFBRSw2U0FBNlMsRUFBQyxDQUFDLENBQUM7QUFDelcsR0FBRyxDQUFDLEtBQUssRUFBRSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IGNkayA9IHJlcXVpcmUoJ0Bhd3MtY2RrL2NvcmUnKTtcbmltcG9ydCBsYW1iZGEgPSByZXF1aXJlKCdAYXdzLWNkay9hd3MtbGFtYmRhJyk7XG5pbXBvcnQgc2ZuID0gcmVxdWlyZSgnQGF3cy1jZGsvYXdzLXN0ZXBmdW5jdGlvbnMnKTtcbmltcG9ydCBpYW0gPSByZXF1aXJlKCdAYXdzLWNkay9hd3MtaWFtJyk7XG5pbXBvcnQgdGFza3MgPSByZXF1aXJlKCdAYXdzLWNkay9hd3Mtc3RlcGZ1bmN0aW9ucy10YXNrcycpO1xuaW1wb3J0IGxvZ3MgPSByZXF1aXJlKFwiQGF3cy1jZGsvYXdzLWxvZ3NcIik7XG5pbXBvcnQgeyBLZXkgfSBmcm9tICdAYXdzLWNkay9hd3Mta21zJztcbmltcG9ydCB7IFVzZXJQb29sIH0gZnJvbSAnQGF3cy1jZGsvYXdzLWNvZ25pdG8nXG5pbXBvcnQgeyBDZm5QYXJhbWV0ZXIsIER1cmF0aW9uIH0gZnJvbSAnQGF3cy1jZGsvY29yZSc7XG5cbmNsYXNzIEpvYlBvbGxlclN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgICBjb25zdHJ1Y3RvcihzY29wZTogY2RrLkFwcCwgaWQ6IHN0cmluZywgcHJvcHM6IGNkay5TdGFja1Byb3BzID0ge30pIHtcbiAgICAgICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG4gICAgICAgIFxuICAgICAgICBjb25zdCBwcmVmaXggPSBcIkFwaUxvYWRUZXN0LVwiXG5cbiAgICAgICAgLy9JTlBVVCBQQVJBTUVURVJTXG4gICAgICAgIGNvbnN0IGFwaV91cmwgPSBuZXcgQ2ZuUGFyYW1ldGVyKHRoaXMsIFwiYXBpR2F0ZXdheVVybFwiLCB7XG4gICAgICAgICAgdHlwZTogXCJTdHJpbmdcIixcbiAgICAgICAgICBkZXNjcmlwdGlvbjogXCJBUEkgR2F0ZXdheSBVUkwgYmVpbmcgbG9hZCB0ZXN0ZWQuXCJ9KTtcblxuICAgICAgICAvL1RPRE86IHJlZ2lzdGVyIHdpdGggQ29nbml0b1xuICAgICAgICBjb25zdCBjdXN0b21FbWFpbFNlbmRlciA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgcHJlZml4LmNvbmNhdCgnY3VzdG9tRW1haWxTZW5kZXInKSwge1xuICAgICAgICAgIGNvZGU6IG5ldyBsYW1iZGEuQXNzZXRDb2RlKCdsYW1iZGEvY3VzdG9tRW1haWxTZW5kZXInKSxcbiAgICAgICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXG4gICAgICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzEyX1hcbiAgICAgICAgfSk7XG4gICAgICAgIFxuICAgICAgICBjdXN0b21FbWFpbFNlbmRlci5ncmFudEludm9rZShuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoXCJjb2duaXRvLWlkcC5hbWF6b25hd3MuY29tXCIpKTtcbiAgICAgICAgY29uc3QgZW1haWxTZW5kZXJLZXkgPSBuZXcgS2V5KHRoaXMsIHByZWZpeC5jb25jYXQoXCJDdXN0b21FbWFpbFNlbmRlcktleVwiKSlcblxuXG4gICAgICAgIGNvbnN0IGNvZ25pdG9Vc2VyUG9vbCA9IG5ldyBVc2VyUG9vbCh0aGlzLCBwcmVmaXguY29uY2F0KCdjb2duaXRvVXNlclBvb2wnKSwge1xuICAgICAgICAgICAgdXNlclBvb2xOYW1lOiBwcmVmaXguY29uY2F0KFwibG9hZHRlc3RpZHBcIiksXG4gICAgICAgICAgICBcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgYXBwQ2xpZW50ID0gY29nbml0b1VzZXJQb29sLmFkZENsaWVudChcInRlc3R1c2Vyc1wiLCB7XG4gICAgICAgICAgICBhdXRoRmxvd3M6IHsgICAgXG4gICAgICAgICAgICAgICAgYWRtaW5Vc2VyUGFzc3dvcmQ6IHRydWVcbiAgICAgICAgICAgIH19KTtcbiAgICAgICAgXG5cbiAgICAgICAgY29uc3QgY3JlYXRlVGVzdFVzZXJJZHMgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsIHByZWZpeC5jb25jYXQoJ2NyZWF0ZVRlc3RVc2VySWRzJyksIHtcbiAgICAgICAgICAgICAgICBoYW5kbGVyOiBcImxhbWJkYV9mdW5jdGlvbi5sYW1iZGFfaGFuZGxlclwiLFxuICAgICAgICAgICAgICAgIGNvZGU6IG5ldyBsYW1iZGEuQXNzZXRDb2RlKCdsYW1iZGEvY3JlYXRlVGVzdFVzZXJJZHMnKSxcbiAgICAgICAgICAgICAgICBtZW1vcnlTaXplOiAxMjgsXG4gICAgICAgICAgICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuUFlUSE9OXzNfOCxcbiAgICAgICAgICAgICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzKVxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBjbGVhblVwVGVzdFVzZXJzID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCBwcmVmaXguY29uY2F0KCdjbGVhblVwVGVzdFVzZXJzJyksIHtcbiAgICAgICAgICAgICAgICBoYW5kbGVyOiBcImxhbWJkYV9mdW5jdGlvbi5sYW1iZGFfaGFuZGxlclwiLFxuICAgICAgICAgICAgICAgIGNvZGU6IG5ldyBsYW1iZGEuQXNzZXRDb2RlKCdsYW1iZGEvY2xlYW5VcFRlc3RVc2VycycpLFxuICAgICAgICAgICAgICAgIG1lbW9yeVNpemU6IDUxMixcbiAgICAgICAgICAgICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM184LFxuICAgICAgICAgICAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDYwMCksXG4gICAgICAgICAgICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIFwiY2xpZW50X2lkXCI6IGFwcENsaWVudC51c2VyUG9vbENsaWVudElkLFxuICAgICAgICAgICAgICAgICAgICAgICAgXCJ1c2VycG9vbF9pZFwiOiBjb2duaXRvVXNlclBvb2wudXNlclBvb2xJZFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNsZWFuVXBUZXN0VXNlcnMucm9sZT8uYWRkTWFuYWdlZFBvbGljeShpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ1NlY3JldHNNYW5hZ2VyUmVhZFdyaXRlJykpO1xuICAgICAgICBjbGVhblVwVGVzdFVzZXJzLnJvbGU/LmFkZE1hbmFnZWRQb2xpY3koaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdBbWF6b25Db2duaXRvUG93ZXJVc2VyJykpO1xuXG4gICAgICAgIGNvbnN0IGNyZWF0ZVRlc3RVc2VycyA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgcHJlZml4LmNvbmNhdCgnY3JlYXRlVGVzdFVzZXJzJyksIHtcbiAgICAgICAgICAgICAgICBoYW5kbGVyOiBcImxhbWJkYV9mdW5jdGlvbi5sYW1iZGFfaGFuZGxlclwiLFxuICAgICAgICAgICAgICAgIGNvZGU6IG5ldyBsYW1iZGEuQXNzZXRDb2RlKCdsYW1iZGEvY3JlYXRlVGVzdFVzZXJzJyksXG4gICAgICAgICAgICAgICAgbWVtb3J5U2l6ZTogODU2LFxuICAgICAgICAgICAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzgsXG4gICAgICAgICAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoOTAwKSxcbiAgICAgICAgICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgICAgICAgICAgICAgICAgXCJjbGllbnRfaWRcIjogYXBwQ2xpZW50LnVzZXJQb29sQ2xpZW50SWQsXG4gICAgICAgICAgICAgICAgICAgICAgICBcInVzZXJwb29sX2lkXCI6IGNvZ25pdG9Vc2VyUG9vbC51c2VyUG9vbElkXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgY3JlYXRlVGVzdFVzZXJzLnJvbGU/LmFkZE1hbmFnZWRQb2xpY3koaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdTZWNyZXRzTWFuYWdlclJlYWRXcml0ZScpKTtcbiAgICAgICAgY3JlYXRlVGVzdFVzZXJzLnJvbGU/LmFkZE1hbmFnZWRQb2xpY3koaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdBbWF6b25Db2duaXRvUG93ZXJVc2VyJykpO1xuICAgICAgICBcblxuICAgICAgICBjb25zdCB0cmlnZ2VyTG9hZFRlc3RQZXJVc2VyID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCBwcmVmaXguY29uY2F0KCd0cmlnZ2VyTG9hZFRlc3RQZXJVc2VyJyksIHtcbiAgICAgICAgICAgICAgICBoYW5kbGVyOiBcImxhbWJkYV9mdW5jdGlvbi5sYW1iZGFfaGFuZGxlclwiLFxuICAgICAgICAgICAgICAgIGNvZGU6IG5ldyBsYW1iZGEuQXNzZXRDb2RlKCdsYW1iZGEvdHJpZ2dlckxvYWRUZXN0UGVyVXNlcicpLFxuICAgICAgICAgICAgICAgIG1lbW9yeVNpemU6IDI1NixcbiAgICAgICAgICAgICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM184LFxuICAgICAgICAgICAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwMCksXG4gICAgICAgICAgICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIFwibnVtYmVyT2ZDYWxsc1BlclVzZXJcIjogXCIkLk51bWJlck9mQ2FsbHNQZXJVc2VyXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBcImNsaWVudF9pZFwiOiBhcHBDbGllbnQudXNlclBvb2xDbGllbnRJZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIFwidXNlcnBvb2xfaWRcIjogY29nbml0b1VzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgICAgICAgICAgICAgICAgICAgICBcImFwaV91cmxcIjogYXBpX3VybC52YWx1ZUFzU3RyaW5nXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIFxuICAgICAgICB0cmlnZ2VyTG9hZFRlc3RQZXJVc2VyLnJvbGU/LmFkZE1hbmFnZWRQb2xpY3koaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdTZWNyZXRzTWFuYWdlclJlYWRXcml0ZScpKTtcbiAgICAgICAgdHJpZ2dlckxvYWRUZXN0UGVyVXNlci5yb2xlPy5hZGRNYW5hZ2VkUG9saWN5KGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnQW1hem9uQ29nbml0b1Bvd2VyVXNlcicpKTtcblxuXG4gICAgICAgIC8vVE9ETzogYWRkIHRvIHN0ZXAgZnVuY3Rpb25zXG4gICAgICAgIC8vIG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgcHJlZml4LmNvbmNhdCgnY2xlYW5VcFRlc3RVc2VyJyksIHtcbiAgICAgICAgLy8gICAgICAgICBoYW5kbGVyOiBcImxhbWJkYV9mdW5jdGlvbi5sYW1iZGFfaGFuZGxlclwiLFxuICAgICAgICAvLyAgICAgICAgIGNvZGU6IG5ldyBsYW1iZGEuQXNzZXRDb2RlKCdsYW1iZGEvY2xlYW5VcFRlc3RVc2VyJyksXG4gICAgICAgIC8vICAgICAgICAgbWVtb3J5U2l6ZTogMTI4LFxuICAgICAgICAvLyAgICAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzgsXG4gICAgICAgIC8vICAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMTApLFxuICAgICAgICAvLyAgICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIC8vICAgICAgICAgICAgICAgICBcImNsaWVudF9pZFwiOiBhcHBDbGllbnQudXNlclBvb2xDbGllbnRJZCxcbiAgICAgICAgLy8gICAgICAgICAgICAgICAgIFwidXNlcnBvb2xfaWRcIjogY29nbml0b1VzZXJQb29sLnVzZXJQb29sSWRcbiAgICAgICAgLy8gICAgICAgICAgICAgfVxuICAgICAgICAvLyB9KTtcblxuICAgICAgICBcbiAgICAgICAgLy8gLy9UT0RPOiBhZGQgdG8gc3RlcCBmdW5jdGlvbnNcbiAgICAgICAgLy8gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCBwcmVmaXguY29uY2F0KCdjcmVhdGVUZXN0VXNlcicpLCB7XG4gICAgICAgIC8vICAgICAgICAgaGFuZGxlcjogXCJsYW1iZGFfZnVuY3Rpb24ubGFtYmRhX2hhbmRsZXJcIixcbiAgICAgICAgLy8gICAgICAgICBjb2RlOiBuZXcgbGFtYmRhLkFzc2V0Q29kZSgnbGFtYmRhL2NyZWF0ZVRlc3RVc2VyJyksXG4gICAgICAgIC8vICAgICAgICAgbWVtb3J5U2l6ZTogMTI4LFxuICAgICAgICAvLyAgICAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzgsXG4gICAgICAgIC8vICAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMTApLFxuICAgICAgICAvLyAgICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIC8vICAgICAgICAgICAgICAgICBcImNsaWVudF9pZFwiOiBhcHBDbGllbnQudXNlclBvb2xDbGllbnRJZCxcbiAgICAgICAgLy8gICAgICAgICAgICAgICAgIFwidXNlcnBvb2xfaWRcIjogY29nbml0b1VzZXJQb29sLnVzZXJQb29sSWRcbiAgICAgICAgLy8gICAgICAgICAgICAgfVxuICAgICAgICAvLyB9KTtcblxuXG4gICAgICAgIC8vU1RFUCBGVU5DVElPTlNcblxuICAgICAgICAvL0xvYWRUZXN0RmFuT3V0XG4gICAgICAgIGNvbnN0IGNyZWF0ZVRlc3RVc2VySWRzSm9iID0gbmV3IHRhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnQ3JlYXRlVGVzdFVzZXJJZHMnLCB7XG4gICAgICAgICAgbGFtYmRhRnVuY3Rpb246IGNyZWF0ZVRlc3RVc2VySWRzLFxuICAgICAgICAgIGlucHV0UGF0aDogJyQudXNlcnMnLFxuICAgICAgICAgIHJlc3VsdFBhdGg6ICckLnRhc2tSZXN1bHQnXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vTG9hZFRlc3RDcmVhdGVVc2VycyAgIFxuICAgICAgICBjb25zdCBjcmVhdGVVc2Vyc0pvYiA9IG5ldyB0YXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ0NyZWF0ZVRlc3RVc2VycycsIHtcbiAgICAgICAgICBsYW1iZGFGdW5jdGlvbjogY3JlYXRlVGVzdFVzZXJzLFxuICAgICAgICAgIGlucHV0UGF0aDogJyQudXNlcnMnLFxuICAgICAgICAgIHJlc3VsdFBhdGg6IFwiJC5jcmVhdGVSZXN1bHRcIlxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCB0cmlnZ2VyTG9hZFRlc3RQZXJVc2VySm9iID0gbmV3IHRhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnVHJpZ2dlckxvYWRUZXN0Jywge1xuICAgICAgICAgIGxhbWJkYUZ1bmN0aW9uOiB0cmlnZ2VyTG9hZFRlc3RQZXJVc2VyXG4gICAgICAgIH0pO1xuXG5cbiAgICAgICAgY29uc3QgZGVmaW5pdGlvbkl0ZXJhdG9yID0gdHJpZ2dlckxvYWRUZXN0UGVyVXNlckpvYjtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgY29uc3QgbG9hZFRlc3RGYW5PdXQgPSBuZXcgc2ZuLk1hcCh0aGlzLCAnTG9hZFRlc3RGYW5PdXQnLCB7XG4gICAgICAgICAgICBtYXhDb25jdXJyZW5jeTogMCxcbiAgICAgICAgICAgIGlucHV0UGF0aDogJyQudGFza1Jlc3VsdC5QYXlsb2FkLnVzZXJOYW1lcydcbiAgICAgICAgfSk7XG4gICAgICAgIFxuICAgICAgICAvL2l0ZW1zUGF0aDogc2ZuLkpzb25QYXRoLnN0cmluZ0F0KCckLnRhc2tSZXN1bHQudXNlck5hbWVzJylcbiAgICAgICAgICAgIFxuICAgICAgICBsb2FkVGVzdEZhbk91dC5pdGVyYXRvcihkZWZpbml0aW9uSXRlcmF0b3IpO1xuICAgICAgICBcbiAgICAgICAgY29uc3Qgam9iVmFsaWRhdGVJbnB1dCA9IG5ldyBzZm4uQ2hvaWNlKHRoaXMsICdJcyBJbnB1dCBWYWxpZD8nKTtcbiAgICAgICAgY29uc3Qgam9iVmFsaWRhdGVOdW1lcmljSW5wdXQgPSBuZXcgc2ZuLkZhaWwodGhpcywgJ0lucHV0IHZhbGlkYXRpb24gZmFpbGVkJywge1xuICAgICAgICAgICAgY2F1c2U6ICdJbnB1dCBWYWxpZGF0aW9uIEZhaWxlZC4gUGxlYXNlIGVuc3VyZSBOdW1iZXJPZlVzZXIgJiBOdW1iZXJPZkNhbGxzUGVyVXNlciBkbyBub3QgZXhjZWVkIGxpbWl0cy4nLFxuICAgICAgICAgICAgZXJyb3I6ICdOdW1iZXJPZlVzZXJzID4gMTAwMCBPUiBOdW1iZXJPZkNhbGxzUGVyVXNlciA+IDEwMDAnLFxuICAgICAgICB9KTtcbiAgICAgICAgY29uc3Qgam9iRG9uZSA9IG5ldyBzZm4uUGFzcyh0aGlzLCAnVGVzdENvbXBsZXRlJywge30pO1xuXG5cbiAgICAgICAgY29uc3QgY29yZURlZmluaXRpb24gPSAoY3JlYXRlVGVzdFVzZXJJZHNKb2IpXG4gICAgICAgIC5uZXh0KGNyZWF0ZVVzZXJzSm9iKVxuICAgICAgICAubmV4dChsb2FkVGVzdEZhbk91dClcbiAgICAgICAgLm5leHQoam9iRG9uZSlcblxuICAgICAgICBjb25zdCBkZWZpbml0aW9uID0gXG4gICAgICAgIGpvYlZhbGlkYXRlSW5wdXRcbiAgICAgICAgICAgIC53aGVuKHNmbi5Db25kaXRpb24ubnVtYmVyR3JlYXRlclRoYW4oJyQudXNlcnMuTnVtYmVyT2ZVc2VycycsIDEwMDApLCBqb2JWYWxpZGF0ZU51bWVyaWNJbnB1dClcbiAgICAgICAgICAgIC53aGVuKHNmbi5Db25kaXRpb24ubnVtYmVyR3JlYXRlclRoYW4oJyQudXNlcnMuTnVtYmVyT2ZDYWxsc1BlclVzZXInLCAxMDAwKSwgam9iVmFsaWRhdGVOdW1lcmljSW5wdXQpXG4gICAgICAgICAgICAub3RoZXJ3aXNlKGNvcmVEZWZpbml0aW9uKVxuXG4gICAgICAgIGNvbnN0IGNyZWF0ZVVzZXJzQW5kRmFuT3V0TG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnQ3JlYXRlVXNlcnNBbmRGYW5PdXRMb2dHcm91cCcpO1xuXG4gICAgICAgIG5ldyBzZm4uU3RhdGVNYWNoaW5lKHRoaXMsIHByZWZpeC5jb25jYXQoJ0NyZWF0ZVVzZXJzQW5kRmFuT3V0JyksIHtcbiAgICAgICAgICAgIGRlZmluaXRpb24sXG4gICAgICAgICAgICBsb2dzOiB7XG4gICAgICAgICAgICAgICAgZGVzdGluYXRpb246IGNyZWF0ZVVzZXJzQW5kRmFuT3V0TG9nR3JvdXAsIFxuICAgICAgICAgICAgICAgIGxldmVsOiBzZm4uTG9nTGV2ZWwuQUxMXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgdGltZW91dDogRHVyYXRpb24ubWludXRlcygxNSlcbiAgICAgICAgfSk7XG5cblxuXG4gICAgICAgIC8vTG9hZFRlc3REZWxldGVVc2VycyAgIFxuICAgICAgICBjb25zdCBjbGVhblVwVGFza0pvYiA9IG5ldyB0YXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ0NsZWFuVXBUYXNrJywge1xuICAgICAgICAgIGxhbWJkYUZ1bmN0aW9uOiBjbGVhblVwVGVzdFVzZXJzXG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgY29uc3QgY2xlYW5VcFRhc2tMb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsICdDbGVhblVwVGFza0xvZ0dyb3VwJyk7XG5cbiAgICAgICAgY29uc3QgY2xlYW5VcEpvYkRvbmUgPSBuZXcgc2ZuLlBhc3ModGhpcywgJ1Rlc3RDbGVhblVwQ29tcGxldGUnLCB7fSk7XG5cbiAgICAgICAgY29uc3QgY2xlYW5VcERlZmluaXRpb24gPSBjbGVhblVwVGFza0pvYlxuICAgICAgICAgICAgLm5leHQoY2xlYW5VcEpvYkRvbmUpXG5cbiAgICAgICAgbmV3IHNmbi5TdGF0ZU1hY2hpbmUodGhpcywgcHJlZml4LmNvbmNhdCgnRGVsZXRlVGVzdFVzZXJzJyksIHtcbiAgICAgICAgICAgIGRlZmluaXRpb246IGNsZWFuVXBEZWZpbml0aW9uLFxuICAgICAgICAgICAgbG9nczoge1xuICAgICAgICAgICAgICAgIGRlc3RpbmF0aW9uOiBjbGVhblVwVGFza0xvZ0dyb3VwLCBcbiAgICAgICAgICAgICAgICBsZXZlbDogc2ZuLkxvZ0xldmVsLkFMTFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLm1pbnV0ZXMoMTApXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vRU5EXG4gICAgICAgIFxuICAgICAgICBcbiAgICAgICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXIgUG9vbCBJRCcsIHtcbiAgICAgICAgICAgICAgdmFsdWU6IGNvZ25pdG9Vc2VyUG9vbC51c2VyUG9vbElkLFxuICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1VzZXIgUG9vbCBJRCcsIFxuICAgICAgICAgICAgICBleHBvcnROYW1lOiAnVXNlclBvb2xJRCcsIFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0tNUyBLZXknLCB7XG4gICAgICAgICAgICAgIHZhbHVlOiBlbWFpbFNlbmRlcktleS5rZXlBcm4sXG4gICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQ3VzdG9tRW1haWxTZW5kZXIgS01TIEtleSBBUk4nLCBcbiAgICAgICAgICAgICAgZXhwb3J0TmFtZTogJ0N1c3RvbUVtYWlsU2VuZGVyS01TS2V5JywgXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ3VzdG9tRW1haWxTZW5kZXIgTGFtYmRhJywge1xuICAgICAgICAgICAgICB2YWx1ZTogY3VzdG9tRW1haWxTZW5kZXIuZnVuY3Rpb25Bcm4sXG4gICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnQ3VzdG9tRW1haWxTZW5kZXIgbGFtYmRhIGZ1bmN0aW9uJywgXG4gICAgICAgICAgICAgIGV4cG9ydE5hbWU6ICdDdXN0b21FbWFpbFNlbmRlckxhbWJkYUFSTicsIFxuICAgICAgICAgICAgfSk7XG5cbiAgICB9XG59XG5cbmNvbnN0IGFwcCA9IG5ldyBjZGsuQXBwKCk7XG5uZXcgSm9iUG9sbGVyU3RhY2soYXBwLCAnYXdzLWFwaWxvYWR0ZXN0Jywge2Rlc2NyaXB0aW9uOiBcIlNlcnZlcmxlc3MgQVBJIEdhdGV3YXkgTG9hZCBUZXN0aW5nIEZyYW1ld29yay4gUnVuIGZvbGxvd2luZyBDTEkgY29tbWFuZCBhZnRlciBzdGFjayBpcyBkZXBsb3llZCwgRXhlY3V0ZSBmb2xsb3dpbmcgQ0xJIGNvbW1hbmQ6IGF3cyBjb2duaXRvLWlkcCB1cGRhdGUtdXNlci1wb29sIC0tdXNlci1wb29sLWlkIElOU0VSVF9QT09MX0lEIC0tbGFtYmRhLWNvbmZpZyBcXFwiQ3VzdG9tRW1haWxTZW5kZXI9e0xhbWJkYVZlcnNpb249VjFfMCxMYW1iZGFBcm49SU5TRVJUX0xBTUJEQV9BUk59LEtNU0tleUlEPUtNU19LRVlfQVJOXFxcIlwifSk7XG5hcHAuc3ludGgoKTtcbiJdfQ==