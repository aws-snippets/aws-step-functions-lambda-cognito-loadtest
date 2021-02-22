<!-- Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: MIT-0
//
Permission is hereby granted, free of charge, to any person obtaining a copy of this
software and associated documentation files (the "Software"), to deal in the Software
without restriction, including without limitation the rights to use, copy, modify,
merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so.
//
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE. -->


# aws-serverless-api-load-test-framework

This repo contains two main components: 
- A simple serverless backend with API Gateway endpoints protected by Cognito authorizer
- A serverless API load testing framework which facilitates running load tests against API Gateway endpoint with Cognito users. 

Supporting AWS CloudFormation templates are available to deploy each of these components. 

Note: The sample web application is only required if you do not have an existing API Gateway endpoint. 

## Content
Here are the contents of this repository:

- [/cognito-protected-api](cognito-protected-api/) - An AWS SAM application to simulate a serverless backend with HTTP-based RESTful API, AWS Cognito authorizer and AWS Lambda functions.
- [/load-test-framework](load-test-framework/) - A serverless load testing framweork built and deployed using CDK. The framework comprises of AWS Step Functions, AWS Lambda functions, AWS Cognito, AWs Secrets Manager and Amazon CloudWatch Logs.

## Deploy the Sample serverless backend

1. Deploy the SAM template  within the folder cognito-protected-api using the guided option to deploy the sample serverless backend.

```bash
sam deploy -g
```

2. Note down the API Gateway URL in the output, we will be using this in one of the steps down below.


3. Deploy the AWS CloudFormation template https://github.com/aws-snippets/apiloadtest/blob/main/load-test-framework/cfn.yml   

    -  To build this app from terminal, navigate to sub-folder load-test-framework then run the following, replacing API_URL with the value returned from above Step#2:

	```bash
	npm install -g aws-cdk
	npm install
	npm run build
	cdk deploy --parameters apiGatewayUrl=API_URL
	```
       
4.  Run following command to grant Cognito permission to invoke the CustomEmailSender lambda function, by replacing INSERT_POOL_ID, 
	INSERT_LAMBDA_ARN and KMS_KEY_ARN from Step 3 above:

	```bash
	aws cognito-idp update-user-pool --user-pool-id INSERT_POOL_ID —lambda-config "CustomEmailSender={LambdaVersion=V1_0,LambdaArn=INSERT_LAMBDA_ARN},KMSKeyID=KMS_KEY_ARN"
	```

5. Edit the Authorizer for API Gateway and update IssuerURL with Cognito User Pool ID and Audience to App Client ID

6. Set Authorization Scope to aws.cognito.signin.user.admin

7. Execute Step Function (name starts with "ApiLoadTestCreateUsersAndFanOut") by giving the following input:
	```bash
		{
			"users": {
			  "NumberOfUsers": "10",
			  "NumberOfCallsPerUser": "100"
			}  
		}
	```

8. After test is complete, check API Gateway CloudWatch logs.
