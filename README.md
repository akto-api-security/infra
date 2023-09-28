Run the following commands to setup Akto - 

If you are using `kubectl` - 


```
kubectl apply -f mongo.yml
kubectl apply -f runtime.yml
kubectl apply -f dashboard.yml
kubectl apply -f testing.yml
```

For `OpenShift` - 

```
oc apply -f mongo.yml
oc apply -f runtime.yml
oc apply -f dashboard.yml
oc apply -f testing.yml

```
