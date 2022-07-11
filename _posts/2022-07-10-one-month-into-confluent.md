---
layout: post
title:  "One month into Confluent"
date:   2022-07-10
last_modified_at: 2022-07-10
categories: [career]
tags: []
---

I left Google and joined Confluent about one month ago. All my career years have been spent in large corporations. Working for a company of Confluent's size is a brand new experience. I am documenting my discoveries and surprises before I get too used to the new world.

## Toolings
Google has such a large range of products that most of the day-to-day tools we use are created within the company, such as video conferencing, collaborative documentations, and etc. The rest of the gaps are mostly filled by other large companies, such as SAP Concur. I did expect smaller companies to rely more on third party vendors. But the actual amount and variety were astonishing. Just to give some examples, they have apps for initialling, communicating, and tracking immigration stuff, for giving feedback, and for managing flags used in code.

It appears they picked the vendors who are also in the startup or small business world, possibly to support each other. These businesses along with Confluent could probably form an ecosystem where the cash flows.

I have to mention that they have a central system `Okta` that is responsible for authentication to everything. It works smoothly and simplistically. Coming from a place where there are extremely strict security rules, as well as tools that enforce the rules, I felt the "freedom".

## Operating systems
I was thrilled when I got the IT questionnaire that asked to pick a laptop between MacBook pro 16" and Thinkpad P15 - those are very powerful and expensive machines. At a second thought, I was wondering if we would be developing on the laptop directly. And the answer is yes.

The model used in many big IT companies is desktop / cloud instance + laptop, for performance and security reasons. So the laptops they provide are usually mid-tier, as they are often just for emails and browsing.

I got the most powerful laptop ever in my life. It is also so heavy that it is not really portable. I installed Linux on it, and found out most software engineers in the company develop on Mac OS. Having been a Mac user for a long time, I got annoyed from time to time when it came to coding directly on Mac. The best alternative was to turn on the laptop and ssh-ing to a Linux box, which is also how I did my job all the time. So it was probably the biggest culture shock when joining Confluent.

## Development environments
I had a few PRs merged and had my hands dirty on so many different tools that I have read about or first heard of. I think the overall experience in Google is more fluent, mainly because of the mono repo. Confluent uses GitHub and microservice architecture, as a result, code is spread across multiple repos. Refactoring or code sharing becomes much harder than back in Google. I will talk more about it in a future post, as I make progress in first project, which is a service migration and involves large amount of refactoring.

I am still exploring the "soft" side of the new company. Maybe I will share more later.
