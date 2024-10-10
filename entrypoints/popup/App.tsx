import React, { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Trash2, Key, Settings, Database, Zap } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { storage } from "wxt/storage";

const optionsStorage = storage.defineItem<{
  extractSchema: boolean;
  captureScreenshot: boolean;
  fullPageContent: boolean;
  maxTimeout: number;
}>("sync:options");

const firecrawlKeyStorage = storage.defineItem<string>("local:firecrawlApiKey");
const contextCache = storage.defineItem<Record<string, any>>("local:contextCache");

export default function App() {
  const [options, setOptions] = useState({
    extractSchema: true,
    captureScreenshot: true,
    fullPageContent: false,
    maxTimeout: 30000,
  });
  const [apiKey, setApiKey] = useState("");
  const [cachedLinks, setCachedLinks] = useState<Record<string, any>>({});

  useEffect(() => {
    const loadData = async () => {
      setOptions((await optionsStorage.getValue()) ?? options);
      setApiKey((await firecrawlKeyStorage.getValue()) ?? "");
      setCachedLinks((await contextCache.getValue()) ?? {});
    };
    loadData();
  }, []);

  const handleOptionChange = async (key: keyof typeof options, value: any) => {
    const newOptions = { ...options, [key]: value };
    setOptions(newOptions);
    await optionsStorage.setValue(newOptions);
  };

  const handleApiKeyChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newApiKey = e.target.value;
    setApiKey(newApiKey);
    await firecrawlKeyStorage.setValue(newApiKey);
  };

  const clearCache = async () => {
    await contextCache.setValue({});
    setCachedLinks({});
  };

  return (
    <div className="w-[400px] p-4">
      <h1 className="text-2xl font-bold mb-4">LinkSnap Settings</h1>
      
      <Tabs defaultValue="options">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="options"><Settings className="w-4 h-4 mr-3" /> Options</TabsTrigger>
          <TabsTrigger value="api"><Key className="w-4 h-4 mr-3" /> API Key</TabsTrigger>
          <TabsTrigger value="cache"><Database className="w-4 h-4 mr-3" /> Cache</TabsTrigger>
        </TabsList>

        <TabsContent value="options">
          <Card>
            <CardHeader>
              <CardTitle>Basic Options</CardTitle>
              <CardDescription>Configure basic LinkSnap preferences.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Capture Screenshots</span>
                <Switch
                  checked={options.captureScreenshot}
                  onCheckedChange={(value) => handleOptionChange("captureScreenshot", value)}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Extract Structured Data</span>
                <Switch
                  checked={options.extractSchema}
                  onCheckedChange={(value) => handleOptionChange("extractSchema", value)}
                />
              </div>
            </CardContent>
          </Card>
          <Card className="mt-3">
            <CardHeader>
              <CardTitle>Advanced Options</CardTitle>
              <CardDescription>Fine-tune LinkSnap behavior.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Full Page Content</span>
                <Switch
                  checked={options.fullPageContent}
                  onCheckedChange={(value) => handleOptionChange("fullPageContent", value)}
                />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Max Timeout (seconds)</span>
                  <span className="text-sm text-muted-foreground">{options.maxTimeout / 1000}s</span>
                </div>
                <Slider
                  value={[options.maxTimeout / 1000]}
                  onValueChange={([value]) => handleOptionChange("maxTimeout", value * 1000)}
                  max={60}
                  min={5}
                  step={5}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="api">
          <Card>
            <CardHeader>
              <CardTitle>API Key</CardTitle>
              <CardDescription>Manage your Firecrawl API key.</CardDescription>
            </CardHeader>
            <CardContent>
              <Input
                type="text"
                value={apiKey}
                onChange={handleApiKeyChange}
                placeholder="Enter your Firecrawl API key"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cache">
          <Card>
            <CardHeader>
              <CardTitle>Cached Links</CardTitle>
              <CardDescription>Manage your cached links.</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[200px] rounded-md border p-2">
                {Object.keys(cachedLinks).length ? (
                  <div className="space-y-2">
                    {Object.entries(cachedLinks).map(([url, state]) => (
                      <div key={url} className="flex items-center justify-between p-2 rounded-lg bg-muted">
                        <span className="truncate text-sm mr-2" title={url}>
                          {url}
                        </span>
                        <Badge variant={state.status === "done" ? "default" : "secondary"}>
                          {state.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">No links cached.</p>
                )}
              </ScrollArea>
              <Button 
                variant="destructive" 
                className="w-full mt-4"
                onClick={clearCache}
              >
                <Trash2 className="w-4 h-4 mr-2" /> Clear Cache
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}