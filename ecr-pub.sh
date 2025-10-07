ECR_PUBLIC_REGION="us-east-1"

ECR_PRIVATE_REGION="ap-south-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

ECR_PRIVATE_REGISTRY="$ACCOUNT_ID.dkr.ecr.$ECR_PRIVATE_REGION.amazonaws.com"
ECR_PRIVATE_REPO_NAMESPACE="ecr-scan-mirror"

get_latest_image_info() {
    echo -e "\nFetching latest image info for repository: $1" >&2

    local repository_name="$1"

    local latest_image_info=$(aws ecr-public describe-images --repository-name "$repository_name" --region "$ECR_PUBLIC_REGION" \
        --query 'sort_by(imageDetails, &imagePushedAt)[-1]' \
        --output json 2>/dev/null)

    local result=$(echo "$latest_image_info" | jq '{imageTags, imageDigest}')
    echo "Latest image info for $repository_name: $result" >&2
    echo "$result"
}

get_all_public_ecr_repos() {
	local next_token=""
	local all_repos="[]"
	while : ; do
        echo -e "\nFetching ecr public repositories with next token: '$next_token'" >&2

		if [ -z "$next_token" ]; then
			response=$(aws ecr-public describe-repositories --region "$ECR_PUBLIC_REGION" --output json)
		else
			response=$(aws ecr-public describe-repositories --region "$ECR_PUBLIC_REGION" --output json --starting-token "$next_token")
		fi

        echo "Response: $response" >&2
        
		repos=$(echo "$response" | jq -c '.repositories[] | {name: .repositoryName, uri: .repositoryUri}')
		updated_repos="[]"

        if [ -n "$repos" ]; then
            while IFS= read -r repo; do
                [ -z "$repo" ] && continue
                repository_name=$(echo "$repo" | jq -r '.name')

                latest_image_info=$(get_latest_image_info "$repository_name")
                # Only add repo if latest_image_info is valid JSON, not null, not empty, and has at least one tag or digest
                if jq -e . >/dev/null 2>&1 <<<"$latest_image_info" \
                    && [ "$latest_image_info" != "null" ] \
                    && [ "$latest_image_info" != "{}" ] \
                    && [ -n "$latest_image_info" ] \
                    && { [ "$(echo "$latest_image_info" | jq -r '.imageTags | length')" -gt 0 ] || [ "$(echo "$latest_image_info" | jq -r '.imageDigest')" != "null" ]; }; then
                    repo=$(echo "$repo" | jq --argjson img_info "$latest_image_info" '. + {latest_image_info: $img_info}')
                    updated_repos=$(jq -s 'add' <(echo "$updated_repos") <(echo "[$repo]"))
                fi
                
            done <<< "$repos"
            all_repos=$(jq -s 'add' <(echo "$all_repos") <(echo "$updated_repos"))
        fi
		
		next_token=$(echo "$response" | jq -r '.nextToken // empty')
		[ -z "$next_token" ] && break
	done
	echo "$all_repos"
}

check_private_repo_exists() {
    local repository_name="$1"
    aws ecr describe-repositories --repository-names "$ECR_PRIVATE_REPO_NAMESPACE/$repository_name" --region $ECR_PRIVATE_REGION > /dev/null 2>&1
    if [ $? -ne 0 ]; then
      echo "ECR Private Repo $ECR_PRIVATE_REPO_NAMESPACE/$repository_name does not exist. Creating..." 
      aws ecr create-repository --repository-name "$ECR_PRIVATE_REPO_NAMESPACE/$repository_name" --region $ECR_PRIVATE_REGION > /dev/null

      # Apply lifecycle policy to the private repo - delete untagged images (create after image push)
      aws ecr put-lifecycle-policy --repository-name "$ECR_PRIVATE_REPO_NAMESPACE/$repository_name" --lifecycle-policy-text "$(cat ecr-scan-mirror-lifecycle-policy.json)" --region $ECR_PRIVATE_REGION > /dev/null
      echo "ECR Private Repo created."
    else
      echo "ECR Private Repo $ECR_PRIVATE_REPO_NAMESPACE/$repository_name already exists."
    fi
}

# Call the function and store output
ECR_PUBLIC_REPOS=$(get_all_public_ecr_repos)

# Login to ECR private
echo -e "\nLogging into ECR Private Registry: $ECR_PRIVATE_REGISTRY"
aws ecr get-login-password --region $ECR_PRIVATE_REGION | docker login --username AWS --password-stdin $ECR_PRIVATE_REGISTRY

for repo in $(echo "$ECR_PUBLIC_REPOS" | jq -c '.[]'); do
    name=$(echo "$repo" | jq -r '.name')
    uri=$(echo "$repo" | jq -r '.uri')
    latest_image_tags=$(echo "$repo" | jq -r '.latest_image_info.imageTags // [] | join(", ")')
    latest_image_digest=$(echo "$repo" | jq -r '.latest_image_info.imageDigest // "N/A"')

    echo -e "\nProcessing repository: $uri"

    # Pull the latest image using any one of the latest tags
    pull_tag=$(echo "$latest_image_tags" | cut -d',' -f1 | xargs) # Get the first tag if multiple
    echo "Pulling image: $uri:$pull_tag"
    docker pull --platform linux/amd64 "$uri:$pull_tag" > /dev/null

    # Check if the private repo exists, if not create it
    check_private_repo_exists $name

    # Tag the image for the private repo
    private_repo_uri="$ECR_PRIVATE_REGISTRY/$ECR_PRIVATE_REPO_NAMESPACE/$name"
    
    for tag in $(echo "$latest_image_tags" | tr ',' '\n'); do
        echo "Tagging image: $uri:$tag as $private_repo_uri:$tag"
        docker tag "$uri:$pull_tag" "$private_repo_uri:$tag"
        
        echo "Pushing image: $private_repo_uri:$tag"
        docker push "$private_repo_uri:$tag" > /dev/null
    done

    # Remove the pulled image to save space
    echo "Removing image: $uri:$pull_tag to save space"
    docker rmi "$uri:$pull_tag" > /dev/null

    # Perform mirroring for a single repo when testing
    # break
done