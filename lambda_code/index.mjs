import axios from "axios"

export const handler = async (event) => {
    console.log('Received event:', JSON.stringify(event, null, 2));

    const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
    const AWS_SHORTCUT_LINK_PREFIX = process.env.AWS_SHORTCUT_LINK_PREFIX

    if (!SLACK_WEBHOOK_URL) {
        console.error("Error: Environment variable SLACK_WEBHOOK_URL is not defined.");

        return {
            statusCode: 500,
        };
    }

    const source = event.source;
    const detailType = event["detail-type"];
    const account = event.account;
    const region = event.region;
    const time = new Date(event.time).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });

    const detail = event.detail;
    
    console.log('source:', source);
    console.log('detailType:', detailType);
    console.log('account:', account);
    console.log('region:', region);
    console.log('time:', time);

    if (source === 'aws.inspector2' && detailType === 'Inspector2 Scan') {
        console.log('Processing Inspector2 Scan event');

        const resource = detail?.["repository-name"];
        const repositoryName = resource?.split('/ecr-scan-mirror/').pop();
        const findingSeverityCounts = detail?.["finding-severity-counts"];

        const criticalCount = findingSeverityCounts?.CRITICAL || 0;
        const highCount = findingSeverityCounts?.HIGH || 0;

        const imageTags = detail?.["image-tags"]?.join(', ') || 'N/A';
        const imageDigest = detail?.["image-digest"] || 'N/A';

        console.log('resource:', resource);
        console.log('repositoryName:', repositoryName);
        console.log('criticalCount:', criticalCount);
        console.log('highCount:', highCount);
        console.log('imageTags:', imageTags);
        console.log('imageDigest:', imageDigest);

        const resourceId = `${resource}/${imageDigest}`
        const encodedResourceId = encodeURIComponent(resourceId);

        const findingsUrl = `https://${region}.console.aws.amazon.com/inspector/v2/home#/findings/container-image/${encodedResourceId}`;
        const encodedFindingsUrl = encodeURIComponent(findingsUrl);
        const scanFindingsShortcutLink = `${AWS_SHORTCUT_LINK_PREFIX}&destination=${encodedFindingsUrl}`

        console.log('findingsShortcutUrl:', scanFindingsShortcutLink);

        // check if criticalCount or highCount is greater than 0
        if (criticalCount > 0 || highCount > 0) {
            console.log(`ALERT: Critical or High vulnerabilities found! Critical: ${criticalCount}, High: ${highCount}`);

            const message = {
                text: `*Critical vulnerabilities found by ECR Image Scan* :rotating_light:`,
                attachments: [
                    {
                        color: '#ff0000', // red color for critical
                        fields: [
                            {
                                title: 'Image Repository',
                                value: repositoryName,
                                short: true
                            },
                            {
                                title: 'Vulnerabilities',
                                value: `*Critical:* ${criticalCount} :red_circle:\t*High:* ${highCount} :large_orange_circle:`,
                                short: true
                            },
                            {
                                title: 'Image Tags',
                                value: imageTags,
                                short: false
                            },
                            {
                                title: 'Time',
                                value: time,
                                short: false
                            },
                            {
                                title: 'View Findings',
                                value: `<${scanFindingsShortcutLink}|View in AWS Console>`,
                                short: false
                            }
                        ],
                        footer: 'AWS ECR Image Scan',
                    }
                ]
            };
        
            
            try {
                const response = await axios.post(SLACK_WEBHOOK_URL, message);
                console.log('Slack webhook response status:', response.status);
            } catch (error) {
                console.error('Error sending Slack webhook:', error);
            }
        }
    }

    const response = {
        statusCode: 200,
    };
    return response;
};
