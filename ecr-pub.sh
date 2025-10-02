AWS_REGION="ap-south-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

ECR_PRIVATE_REGISTRY="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
ECR_PRIVATE_REPO_NAMESPACE="ecr-scan-mirror"

get_latest_image_info() {
    echo -e "\nFetching latest image info for repository: $1" >&2

    local repository_name="$1"

    local latest_image_info=$(aws ecr describe-images --repository-name "$repository_name" --region "$AWS_REGION" \
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
		if [ -z "$next_token" ]; then
			response=$(aws ecr describe-repositories --region "$AWS_REGION" --output json)
		else
			response=$(aws ecr describe-repositories --region "$AWS_REGION" --output json --starting-token "$next_token")
		fi
        
		repos=$(echo "$response" | jq -c '.repositories[] | {name: .repositoryName, uri: .repositoryUri}')
		updated_repos="[]"
		while IFS= read -r repo; do
			# Add is_public: true (or set based on a condition)
            repository_name=$(echo "$repo" | jq -r '.name')
            if [[ "$repository_name" == "$ECR_PRIVATE_REPO_NAMESPACE"* ]]; then
                continue
            fi

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
		
		next_token=$(echo "$response" | jq -r '.nextToken // empty')
		[ -z "$next_token" ] && break
	done
	echo "$all_repos"
}

check_private_repo_exists() {
    local repository_name="$1"
    aws ecr describe-repositories --repository-names "$ECR_PRIVATE_REPO_NAMESPACE/$repository_name" --region $AWS_REGION > /dev/null 2>&1
    if [ $? -ne 0 ]; then
      echo "ECR Private Repo $ECR_PRIVATE_REPO_NAMESPACE/$repository_name does not exist. Creating..." 
      aws ecr create-repository --repository-name "$ECR_PRIVATE_REPO_NAMESPACE/$repository_name" --region $AWS_REGION > /dev/null

      # Apply lifecycle policy to the private repo - delete untagged images (create after image push)
      aws ecr put-lifecycle-policy --repository-name "$ECR_PRIVATE_REPO_NAMESPACE/$repository_name" --lifecycle-policy-text "$(cat ecr-scan-mirror-lifecycle-policy.json)" --region $AWS_REGION > /dev/null
      echo "ECR Private Repo created."
    else
      echo "ECR Private Repo $ECR_PRIVATE_REPO_NAMESPACE/$repository_name already exists."
    fi
}

# Call the function and store output
ECR_PUBLIC_REPOS=$(get_all_public_ecr_repos)

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
done